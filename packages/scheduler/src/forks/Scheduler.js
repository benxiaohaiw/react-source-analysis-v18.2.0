/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-disable no-var */

import type {PriorityLevel} from '../SchedulerPriorities';

import {
  enableSchedulerDebugging,
  enableProfiling,
  enableIsInputPending,
  enableIsInputPendingContinuous,
  frameYieldMs,
  continuousYieldMs,
  maxYieldMs,
} from '../SchedulerFeatureFlags';

import {push, pop, peek} from '../SchedulerMinHeap';

// TODO: Use symbols?
import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  LowPriority,
  IdlePriority,
} from '../SchedulerPriorities';
import {
  markTaskRun,
  markTaskYield,
  markTaskCompleted,
  markTaskCanceled,
  markTaskErrored,
  markSchedulerSuspended,
  markSchedulerUnsuspended,
  markTaskStart,
  stopLoggingProfilingEvents,
  startLoggingProfilingEvents,
} from '../SchedulerProfiling';

export type Callback = boolean => ?Callback;

type Task = {
  id: number,
  callback: Callback | null,
  priorityLevel: PriorityLevel,
  startTime: number,
  expirationTime: number,
  sortIndex: number,
  isQueued?: boolean,
};

let getCurrentTime: () => number | DOMHighResTimeStamp;
const hasPerformanceNow =
  // $FlowFixMe[method-unbinding]
  typeof performance === 'object' && typeof performance.now === 'function';

if (hasPerformanceNow) {
  const localPerformance = performance;
  getCurrentTime = () => localPerformance.now();
} else {
  const localDate = Date;
  const initialTime = localDate.now();
  getCurrentTime = () => localDate.now() - initialTime;
}

// Max 31 bit integer. The max integer size in V8 for 32-bit systems.
// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
var maxSigned31BitInt = 1073741823;

// Times out immediately
var IMMEDIATE_PRIORITY_TIMEOUT = -1;
// Eventually times out
var USER_BLOCKING_PRIORITY_TIMEOUT = 250;
var NORMAL_PRIORITY_TIMEOUT = 5000;
var LOW_PRIORITY_TIMEOUT = 10000;
// Never times out
var IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;

// Tasks are stored on a min heap
var taskQueue: Array<Task> = [];
var timerQueue: Array<Task> = [];

// Incrementing id counter. Used to maintain insertion order.
var taskIdCounter = 1;

// Pausing the scheduler is useful for debugging.
var isSchedulerPaused = false;

var currentTask = null;
var currentPriorityLevel = NormalPriority;

// This is set while performing work, to prevent re-entrance.
var isPerformingWork = false;

var isHostCallbackScheduled = false;
var isHostTimeoutScheduled = false;

// Capture local references to native APIs, in case a polyfill overrides them.
const localSetTimeout = typeof setTimeout === 'function' ? setTimeout : null;
const localClearTimeout =
  typeof clearTimeout === 'function' ? clearTimeout : null;
const localSetImmediate =
  typeof setImmediate !== 'undefined' ? setImmediate : null; // IE and Node.js + jsdom

const isInputPending =
  typeof navigator !== 'undefined' &&
  // $FlowFixMe[prop-missing]
  navigator.scheduling !== undefined &&
  // $FlowFixMe[incompatible-type]
  navigator.scheduling.isInputPending !== undefined
    ? navigator.scheduling.isInputPending.bind(navigator.scheduling)
    : null;

const continuousOptions = {includeContinuous: enableIsInputPendingContinuous};

// 前进延时队列中的任务
function advanceTimers(currentTime: number) {
  // 检查不再延迟的任务并将它们添加到队列中。
  // Check for tasks that are no longer delayed and add them to the queue.
  let timer = peek(timerQueue); // 延时任务队列
  while (timer !== null) {
    if (timer.callback === null) {
      // Timer was cancelled.
      pop(timerQueue); // 这个任务是被取消了
    } else if (timer.startTime <= currentTime) { // 延时任务的开始时间 <= 当前时间
      // 定时器触发。转移到任务队列。
      // Timer fired. Transfer to the task queue.
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime; // 改变它的排序下标为过期时间
      push(taskQueue, timer); // 推入到过期任务队列中
      if (enableProfiling) {
        markTaskStart(timer, currentTime);
        timer.isQueued = true;
      }
    } else {
      // 延时任务的开始时间 > 当前时间
      // 剩余的计时器待定。
      // Remaining timers are pending.
      return;
    }
    timer = peek(timerQueue); // 再次从延时任务队列中挑选延时任务
  }
}

// 处理超时
function handleTimeout(currentTime: number) {
  isHostTimeoutScheduled = false;
  // 因为在超时结束后可能会有其它的延时任务过期了（也就是要执行了），所以就需要执行这部操作把其移入过期任务队列中来
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      // 过期任务队列中有任务的
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork); // 再次刷新工作
    } else {
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime); // 再次请求主机超时
      }
    }
  }
}

// 刷新工作
function flushWork(hasTimeRemaining: boolean, initialTime: number) {
  if (enableProfiling) {
    markSchedulerUnsuspended(initialTime);
  }

  // 当前函数被执行了那就调整isHostCallbackScheduled为false
  // We'll need a host callback the next time work is scheduled.
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) {
    // We scheduled a timeout but it's no longer needed. Cancel it.
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  // 是正在执行工作中
  isPerformingWork = true;
  const previousPriorityLevel = currentPriorityLevel; // 当前优先级默认是NormalPriority
  try {
    if (enableProfiling) {
      try {
        return workLoop(hasTimeRemaining, initialTime);
      } catch (error) {
        if (currentTask !== null) {
          const currentTime = getCurrentTime();
          // $FlowFixMe[incompatible-call] found when upgrading Flow
          markTaskErrored(currentTask, currentTime);
          // $FlowFixMe[incompatible-use] found when upgrading Flow
          currentTask.isQueued = false;
        }
        throw error;
      }
    } else {
      // No catch in prod code path.
      return workLoop(hasTimeRemaining, initialTime); // 工作循环
    }
  } finally {
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
    if (enableProfiling) {
      const currentTime = getCurrentTime();
      markSchedulerSuspended(currentTime);
    }
  }
}

function workLoop(hasTimeRemaining: boolean, initialTime: number) {
  let currentTime = initialTime; // 当前时间
  // 还是看下延时任务队列中是否有任务过期了
  advanceTimers(currentTime);
  currentTask = peek(taskQueue); // 从过期任务队列taskQueue中挑选任务
  while (
    currentTask !== null &&
    !(enableSchedulerDebugging && isSchedulerPaused)
  ) {
    if (
      // 过期任务的过期时间是否大于当前时间
      // 我们知道正常优先级对应的cb的过期时间是向后延迟5s
      currentTask.expirationTime > currentTime &&
      (!hasTimeRemaining || shouldYieldToHost()/** 超了帧间隔那么应该yield */)
    ) {
      // 这个 currentTask 还没有过期，我们已经到了最后期限。
      // This currentTask hasn't expired, and we've reached the deadline.
      break; // 退出
    }
    // $FlowFixMe[incompatible-use] found when upgrading Flow
    const callback = currentTask.callback;
    if (typeof callback === 'function') {
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      currentTask.callback = null;
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      currentPriorityLevel = currentTask.priorityLevel;
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      // 用户回调是否已超时
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime; // 过期时间是否小于等于当前时间
      if (enableProfiling) {
        // $FlowFixMe[incompatible-call] found when upgrading Flow
        markTaskRun(currentTask, currentTime);
      }
      // 继续回调
      // 用户回调是否已超时传入cb中
      const continuationCallback = callback(didUserCallbackTimeout); // 执行callback
      currentTime = getCurrentTime(); // 执行了cb后再次获取当前时间
      // 返回函数说明cb执行期间任务中断了
      if (typeof continuationCallback === 'function') {
        // If a continuation is returned, immediately yield to the main thread
        // regardless of how much time is left in the current time slice.
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        currentTask.callback = continuationCallback; // 再次赋值
        if (enableProfiling) {
          // $FlowFixMe[incompatible-call] found when upgrading Flow
          markTaskYield(currentTask, currentTime);
        }
        // 再去看下延时任务队列
        advanceTimers(currentTime);
        return true; // 返回true表示还有任务
      } else {
        // 返回其它表示cb执行完毕
        if (enableProfiling) {
          // $FlowFixMe[incompatible-call] found when upgrading Flow
          markTaskCompleted(currentTask, currentTime);
          // $FlowFixMe[incompatible-use] found when upgrading Flow
          currentTask.isQueued = false;
        }

        // peek只是挑选任务 - 任务并没有移除
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue); // 移除此任务
        }
        // 再去看下延时任务队列 - 移入过期任务队列中来
        advanceTimers(currentTime);
      }
    } else {
      // 不是函数直接弹出
      pop(taskQueue);
    }
    // 再次向过期任务队列中挑选任务
    currentTask = peek(taskQueue);
  }
  // 返回是否有额外的工作
  // Return whether there's additional work
  if (currentTask !== null) {
    return true; // 有
  } else {
    const firstTimer = peek(timerQueue); // 延时任务队列有任务
    if (firstTimer !== null) {
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false;
  }
}

function unstable_runWithPriority<T>(
  priorityLevel: PriorityLevel,
  eventHandler: () => T,
): T {
  switch (priorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
    case LowPriority:
    case IdlePriority:
      break;
    default:
      priorityLevel = NormalPriority;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

function unstable_next<T>(eventHandler: () => T): T {
  var priorityLevel;
  switch (currentPriorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      // Shift down to normal priority
      priorityLevel = NormalPriority;
      break;
    default:
      // Anything lower than normal priority should remain at the current level.
      priorityLevel = currentPriorityLevel;
      break;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

function unstable_wrapCallback<T: (...Array<mixed>) => mixed>(callback: T): T {
  var parentPriorityLevel = currentPriorityLevel;
  // $FlowFixMe[incompatible-return]
  return function() {
    // This is a fork of runWithPriority, inlined for performance.
    var previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = parentPriorityLevel;

    try {
      return callback.apply(this, arguments);
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  };
}

// 调度回调
function unstable_scheduleCallback(
  priorityLevel: PriorityLevel, // 优先级
  callback: Callback, // 回调
  options?: {delay: number},
): Task {
  var currentTime = getCurrentTime(); // Date.now()

  var startTime;
  if (typeof options === 'object' && options !== null) {
    var delay = options.delay;
    if (typeof delay === 'number' && delay > 0) {
      startTime = currentTime + delay;
    } else {
      startTime = currentTime;
    }
  } else {
    startTime = currentTime; // 赋值
  }

  var timeout;
  switch (priorityLevel) {
    case ImmediatePriority:
      timeout = IMMEDIATE_PRIORITY_TIMEOUT;
      break;
    case UserBlockingPriority:
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT;
      break;
    case IdlePriority:
      timeout = IDLE_PRIORITY_TIMEOUT;
      break;
    case LowPriority:
      timeout = LOW_PRIORITY_TIMEOUT;
      break;
    case NormalPriority: // 3
    default:
      timeout = NORMAL_PRIORITY_TIMEOUT; // 5000
      break;
  }

  // 开始事件加上超时等于它的过期事件
  // 也就是NormalPriority对应的回调过期时间是5s之后
  var expirationTime = startTime + timeout;

  // 创建一个新的任务
  var newTask: Task = {
    id: taskIdCounter++, // 1进行++
    callback, // 回调
    priorityLevel, // 优先级
    startTime,
    expirationTime, // 过期时间
    sortIndex: -1,
  };
  if (enableProfiling) {
    newTask.isQueued = false;
  }

  // 开始时间大于当前时间 - 说明此任务是延时任务
  if (startTime > currentTime) {
    // This is a delayed task.
    newTask.sortIndex = startTime; // 排序下标为开始时间
    push(timerQueue, newTask); // 推入到延时任务队列中
    // 过期任务队列中没有且延时任务队列中挑选的任务就是这个任务
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // 所有任务都有延迟，这是延迟最早的任务。
      // All tasks are delayed, and this is the task with the earliest delay.
      if (isHostTimeoutScheduled) {
        // 取消现有的超时。
        // Cancel an existing timeout.
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      // 安排超时。
      // Schedule a timeout.
      requestHostTimeout(handleTimeout, startTime - currentTime); // 延时任务的间隔为开始时间 - 当前时间
    }
  } else {
    // 开始时间小于等于当前时间表示当前新任务已经是过期的了，需要推入到taskQueue中
    // 它代表过期任务的队列
    // 任务的排序下标变为过期时间
    newTask.sortIndex = expirationTime;
    push(taskQueue, newTask); // 推入到taskQueue中
    if (enableProfiling) {
      markTaskStart(newTask, currentTime);
      newTask.isQueued = true;
    }
    // Schedule a host callback, if needed. If we're already performing work,
    // wait until the next time we yield.

    // 全局变量
    // isHostCallbackScheduled: false
    // isPerformingWork: false
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true; // 调为true
      // 请求主机回调
      requestHostCallback(flushWork);
    }
  }

  // 返回任务
  return newTask;
}

function unstable_pauseExecution() {
  isSchedulerPaused = true;
}

function unstable_continueExecution() {
  isSchedulerPaused = false;
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true;
    requestHostCallback(flushWork);
  }
}

function unstable_getFirstCallbackNode(): Task | null {
  return peek(taskQueue);
}

function unstable_cancelCallback(task: Task) {
  if (enableProfiling) {
    if (task.isQueued) {
      const currentTime = getCurrentTime();
      markTaskCanceled(task, currentTime);
      task.isQueued = false;
    }
  }

  // Null out the callback to indicate the task has been canceled. (Can't
  // remove from the queue because you can't remove arbitrary nodes from an
  // array based heap, only the first one.)
  task.callback = null;
}

function unstable_getCurrentPriorityLevel(): PriorityLevel {
  return currentPriorityLevel;
}

let isMessageLoopRunning = false;
let scheduledHostCallback:
  | null
  | ((
      hasTimeRemaining: boolean,
      initialTime: DOMHighResTimeStamp | number,
    ) => boolean) = null;
let taskTimeoutID: TimeoutID = (-1: any);

// Scheduler periodically yields in case there is other work on the main
// thread, like user events. By default, it yields multiple times per frame.
// It does not attempt to align with frame boundaries, since most tasks don't
// need to be frame aligned; for those that do, use requestAnimationFrame.
let frameInterval = frameYieldMs;
const continuousInputInterval = continuousYieldMs;
const maxInterval = maxYieldMs;
let startTime = -1;

let needsPaint = false;

// 应该yield
function shouldYieldToHost(): boolean {
  const timeElapsed = getCurrentTime() - startTime;
  // 当前时间 - 开始时间 < 帧间隔 - 表示还有时间可以继续执行 - 那么不应该yield则返回false
  if (timeElapsed < frameInterval) {
    // The main thread has only been blocked for a really short amount of time;
    // smaller than a single frame. Don't yield yet.
    return false;
  }

  // The main thread has been blocked for a non-negligible amount of time. We
  // may want to yield control of the main thread, so the browser can perform
  // high priority tasks. The main ones are painting and user input. If there's
  // a pending paint or a pending input, then we should yield. But if there's
  // neither, then we can yield less often while remaining responsive. We'll
  // eventually yield regardless, since there could be a pending paint that
  // wasn't accompanied by a call to `requestPaint`, or other main thread tasks
  // like network events.
  if (enableIsInputPending) {
    if (needsPaint) {
      // There's a pending paint (signaled by `requestPaint`). Yield now.
      return true;
    }
    if (timeElapsed < continuousInputInterval) {
      // We haven't blocked the thread for that long. Only yield if there's a
      // pending discrete input (e.g. click). It's OK if there's pending
      // continuous input (e.g. mouseover).
      if (isInputPending !== null) {
        return isInputPending();
      }
    } else if (timeElapsed < maxInterval) {
      // Yield if there's either a pending discrete or continuous input.
      if (isInputPending !== null) {
        return isInputPending(continuousOptions);
      }
    } else {
      // We've blocked the thread for a long time. Even if there's no pending
      // input, there may be some other scheduled work that we don't know about,
      // like a network event. Yield now.
      return true;
    }
  }

  // 返回true表示应该yield
  // `isInputPending` isn't available. Yield now.
  return true;
}

function requestPaint() {
  if (
    enableIsInputPending &&
    navigator !== undefined &&
    // $FlowFixMe[prop-missing]
    navigator.scheduling !== undefined &&
    // $FlowFixMe[incompatible-type]
    navigator.scheduling.isInputPending !== undefined
  ) {
    needsPaint = true;
  }

  // Since we yield every frame regardless, `requestPaint` has no effect.
}

function forceFrameRate(fps: number) {
  if (fps < 0 || fps > 125) {
    // Using console['error'] to evade Babel and ESLint
    console['error'](
      'forceFrameRate takes a positive int between 0 and 125, ' +
        'forcing frame rates higher than 125 fps is not supported',
    );
    return;
  }
  if (fps > 0) {
    frameInterval = Math.floor(1000 / fps);
  } else {
    // reset the framerate
    frameInterval = frameYieldMs;
  }
}

// 执行工作直到最后期限
const performWorkUntilDeadline = () => {
  if (scheduledHostCallback !== null) {
    // 当前函数是作为一个宏任务被执行的，所以需要再次获取当前的时间
    // 再次获取当前时间 - Date.now()
    const currentTime = getCurrentTime();
    // Keep track of the start time so we can measure how long the main thread
    // has been blocked.
    startTime = currentTime; // 赋值给开始时间
    const hasTimeRemaining = true; // 默认是有时间剩余的

    // If a scheduler task throws, exit the current browser task so the
    // error can be observed.
    //
    // Intentionally not using a try-catch, since that makes some debugging
    // techniques harder. Instead, if `scheduledHostCallback` errors, then
    // `hasMoreWork` will remain true, and we'll continue the work loop.
    let hasMoreWork = true; // 默认是有许多工作的
    try {
      // $FlowFixMe[not-a-function] found when upgrading Flow
      hasMoreWork = scheduledHostCallback(hasTimeRemaining, currentTime); // 直接执行flushWork
    } finally {
      // flushWork执行完后返回true表示还有更多的任务
      if (hasMoreWork) {
        // 如果有更多的工作，将下一个消息事件安排在前一个消息事件的末尾。
        // If there's more work, schedule the next message event at the end
        // of the preceding one.
        schedulePerformWorkUntilDeadline();
      } else {
        // 重置状态
        isMessageLoopRunning = false;
        scheduledHostCallback = null;
      }
    }
  } else {
    isMessageLoopRunning = false;
  }
  // Yielding to the browser will give it a chance to paint, so we can
  // reset this.
  needsPaint = false;
};

let schedulePerformWorkUntilDeadline;
if (typeof localSetImmediate === 'function') {
  // Node.js and old IE.
  // There's a few reasons for why we prefer setImmediate.
  //
  // Unlike MessageChannel, it doesn't prevent a Node.js process from exiting.
  // (Even though this is a DOM fork of the Scheduler, you could get here
  // with a mix of Node.js 15+, which has a MessageChannel, and jsdom.)
  // https://github.com/facebook/react/issues/20756
  //
  // But also, it runs earlier which is the semantic we want.
  // If other browsers ever implement it, it's better to use it.
  // Although both of these would be inferior to native scheduling.
  schedulePerformWorkUntilDeadline = () => {
    localSetImmediate(performWorkUntilDeadline);
  };
} else if (typeof MessageChannel !== 'undefined') {
  // DOM and Worker environments.
  // We prefer MessageChannel because of the 4ms setTimeout clamping.
  const channel = new MessageChannel();
  const port = channel.port2;
  channel.port1.onmessage = performWorkUntilDeadline; // 宏任务
  // 执行这个函数
  schedulePerformWorkUntilDeadline = () => {
    port.postMessage(null); // 宏任务
  };
} else {
  // We should only fallback here in non-browser environments.
  schedulePerformWorkUntilDeadline = () => {
    // $FlowFixMe[not-a-function] nullable value
    localSetTimeout(performWorkUntilDeadline, 0);
  };
}

// 请求主机回调
function requestHostCallback(callback) { // cb: flushWork
  // 全局变量默认为null
  scheduledHostCallback = callback; // 调度主机回调赋值为flushWork
  // // 全局变量默认为false，也就是消息循环不在运行中
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true; // 改为运行中
    // 调度执行工作直到最后期限
    schedulePerformWorkUntilDeadline();
  }
}

// 请求主机超时
function requestHostTimeout(callback, ms: number) {
  // $FlowFixMe[not-a-function] nullable value
  taskTimeoutID = localSetTimeout(() => { // 直接一个setTimeout
    callback(getCurrentTime());
  }, ms);
}

// 取消主机超时
function cancelHostTimeout() {
  // $FlowFixMe[not-a-function] nullable value
  localClearTimeout(taskTimeoutID); // 清除定时器
  taskTimeoutID = ((-1: any): TimeoutID);
}

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
  unstable_runWithPriority,
  unstable_next,
  unstable_scheduleCallback, // 调度回调
  unstable_cancelCallback,
  unstable_wrapCallback,
  unstable_getCurrentPriorityLevel,
  shouldYieldToHost as unstable_shouldYield,
  requestPaint as unstable_requestPaint,
  unstable_continueExecution,
  unstable_pauseExecution,
  unstable_getFirstCallbackNode,
  getCurrentTime as unstable_now,
  forceFrameRate as unstable_forceFrameRate,
};

export const unstable_Profiling: {
  startLoggingProfilingEvents(): void,
  stopLoggingProfilingEvents(): ArrayBuffer | null,
} | null = enableProfiling
  ? {
      startLoggingProfilingEvents,
      stopLoggingProfilingEvents,
    }
  : null;
