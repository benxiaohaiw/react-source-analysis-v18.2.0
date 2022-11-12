/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {
  UpdateQueue as HookQueue,
  Update as HookUpdate,
} from './ReactFiberHooks.new';
import type {
  SharedQueue as ClassQueue,
  Update as ClassUpdate,
} from './ReactFiberClassUpdateQueue.new';
import type {Lane, Lanes} from './ReactFiberLane.new';
import type {OffscreenInstance} from './ReactFiberOffscreenComponent';

import {
  warnAboutUpdateOnNotYetMountedFiberInDEV,
  throwIfInfiniteUpdateLoopDetected,
  getWorkInProgressRoot,
} from './ReactFiberWorkLoop.new';
import {
  NoLane,
  NoLanes,
  mergeLanes,
  markHiddenUpdate,
} from './ReactFiberLane.new';
import {NoFlags, Placement, Hydrating} from './ReactFiberFlags';
import {HostRoot, OffscreenComponent} from './ReactWorkTags';
import {OffscreenVisible} from './ReactFiberOffscreenComponent';

export type ConcurrentUpdate = {
  next: ConcurrentUpdate,
  lane: Lane,
};

type ConcurrentQueue = {
  pending: ConcurrentUpdate | null,
};

// If a render is in progress, and we receive an update from a concurrent event,
// we wait until the current render is over (either finished or interrupted)
// before adding it to the fiber/hook queue. Push to this array so we can
// access the queue, fiber, update, et al later.
const concurrentQueues: Array<any> = [];
let concurrentQueuesIndex = 0;

let concurrentlyUpdatedLanes: Lanes = NoLanes; // 0


// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// 完成排队中并发更新 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function finishQueueingConcurrentUpdates(): void {
  const endIndex = concurrentQueuesIndex;
  
  // 重置
  concurrentQueuesIndex = 0; // 重置为0

  concurrentlyUpdatedLanes = NoLanes; // 重置为0

  let i = 0;
  while (i < endIndex) { // while循环

    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // 一一取出 - 并置为null
    const fiber: Fiber = concurrentQueues[i];
    concurrentQueues[i++] = null;
    const queue: ConcurrentQueue = concurrentQueues[i];
    concurrentQueues[i++] = null;
    const update: ConcurrentUpdate = concurrentQueues[i];
    concurrentQueues[i++] = null;
    const lane: Lane = concurrentQueues[i];
    concurrentQueues[i++] = null;

    // queue和update都不为null
    if (queue !== null && update !== null) {
      const pending = queue.pending; // 取出queue的pending属性
      if (pending === null) { // 这是第一次更新。创建一个循环列表。
        // This is the first update. Create a circular list.
        update.next = update; // 
      } else {
        // 现在的指向之前的
        update.next = pending.next;
        // 之前的指向现在的
        pending.next = update;
      }
      // 形成环形链表 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

      // 0 -> 1 -> 2 -> 0
      // 也就是让pending指向2，这样就能够直接通过next获取0啦 ~ // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // 始终让queue的pending属性指向update环形链表的最后一个update - 这样目的是能够直接获取环形链表的第一个update对象
      // 使queue.pending指向现在的update
      queue.pending = update;
    }
    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    // 车道不是NoLane
    if (lane !== NoLane) {
      // 从这个fiber开始到root标记更新车道
      markUpdateLaneFromFiberToRoot(fiber, update, lane); // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }
  }
}


// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function getConcurrentlyUpdatedLanes(): Lanes {
  return concurrentlyUpdatedLanes;
}

// 入队更新
function enqueueUpdate(
  fiber: Fiber,
  queue: ConcurrentQueue | null,
  update: ConcurrentUpdate | null,
  lane: Lane,
) {
  // Don't update the `childLanes` on the return path yet. If we already in
  // the middle of rendering, wait until after it has completed.

  // concurrentQueuesIndex: 0
  // concurrentQueues是一个数组
  // 存在这里面
  concurrentQueues[concurrentQueuesIndex++] = fiber;
  concurrentQueues[concurrentQueuesIndex++] = queue;
  concurrentQueues[concurrentQueuesIndex++] = update;
  concurrentQueues[concurrentQueuesIndex++] = lane;
  // 存入

  // mergeLanes的逻辑是直接这两个参数做一个或|运算 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // 16
  concurrentlyUpdatedLanes = mergeLanes(concurrentlyUpdatedLanes, lane); // 0 16
  // click -> 0 1
  // setTimeout -> 0 16

  // The fiber's `lane` field is used in some places to check if any work is
  // scheduled, to perform an eager bailout, so we need to update it immediately.
  // TODO: We should probably move this to the "shared" queue instead.
  fiber.lanes = mergeLanes(fiber.lanes, lane); // 16 // ++++++++++++++++++++++++++++++++++++
  const alternate = fiber.alternate; // alternate
  if (alternate !== null) {
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    alternate.lanes = mergeLanes(alternate.lanes, lane); // 也改变alternate的lanes // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }
}

// 入队列并发hook更新 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function enqueueConcurrentHookUpdate<S, A>(
  fiber: Fiber,
  queue: HookQueue<S, A>,
  update: HookUpdate<S, A>,
  lane: Lane,
): FiberRoot | null {
  
  const concurrentQueue: ConcurrentQueue = (queue: any); // queue对象（dispatchSetState函数绑定的那个queue对象）
  const concurrentUpdate: ConcurrentUpdate = (update: any); // 准备的update对象
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  
  // 入队列更新
  enqueueUpdate(fiber, concurrentQueue, concurrentUpdate, lane); // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  return getRootForUpdatedFiber(fiber); // 为更新fiber获取root，其实就是返回FiberRootNode // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

export function enqueueConcurrentHookUpdateAndEagerlyBailout<S, A>(
  fiber: Fiber,
  queue: HookQueue<S, A>,
  update: HookUpdate<S, A>,
): void {
  // This function is used to queue an update that doesn't need a rerender. The
  // only reason we queue it is in case there's a subsequent higher priority
  // update that causes it to be rebased.
  const lane = NoLane;
  const concurrentQueue: ConcurrentQueue = (queue: any);
  const concurrentUpdate: ConcurrentUpdate = (update: any);
  enqueueUpdate(fiber, concurrentQueue, concurrentUpdate, lane);

  // Usually we can rely on the upcoming render phase to process the concurrent
  // queue. However, since this is a bail out, we're not scheduling any work
  // here. So the update we just queued will leak until something else happens
  // to schedule work (if ever).
  //
  // Check if we're currently in the middle of rendering a tree, and if not,
  // process the queue immediately to prevent a leak.
  const isConcurrentlyRendering = getWorkInProgressRoot() !== null;
  if (!isConcurrentlyRendering) {
    finishQueueingConcurrentUpdates();
  }
}

// 入队并发类更新
export function enqueueConcurrentClassUpdate<State>(
  fiber: Fiber,
  queue: ClassQueue<State>,
  update: ClassUpdate<State>,
  lane: Lane,
): FiberRoot | null {
  const concurrentQueue: ConcurrentQueue = (queue: any);
  const concurrentUpdate: ConcurrentUpdate = (update: any);
  // 入队更新
  // FiberRootNode.current

  // {
  //   "pending": null,
  //   "interleaved": null,
  //   "lanes": 0
  // }

  // {
  //   "eventTime": 1222454.0999999996,
  //   "lane": 16,
  //   "tag": 0,
  //   "payload": {
  //     "element": {
  //       "$$typeof": Symbol(react.element),
  //       "type": f App(),
  //       "key": null,
  //       "ref": null,
  //       "props": {},
  //     }
  //   },
  //   "callback": null,
  //   "next": null
  // }
  enqueueUpdate(fiber, concurrentQueue, concurrentUpdate, lane); // 16
  return getRootForUpdatedFiber(fiber); // 返回FiberRootNode
}

export function enqueueConcurrentRenderForLane(
  fiber: Fiber,
  lane: Lane,
): FiberRoot | null {
  enqueueUpdate(fiber, null, null, lane);
  return getRootForUpdatedFiber(fiber);
}

// Calling this function outside this module should only be done for backwards
// compatibility and should always be accompanied by a warning.
export function unsafe_markUpdateLaneFromFiberToRoot(
  sourceFiber: Fiber,
  lane: Lane,
): FiberRoot | null {
  // NOTE: For Hyrum's Law reasons, if an infinite update loop is detected, it
  // should throw before `markUpdateLaneFromFiberToRoot` is called. But this is
  // undefined behavior and we can change it if we need to; it just so happens
  // that, at the time of this writing, there's an internal product test that
  // happens to rely on this.
  const root = getRootForUpdatedFiber(sourceFiber);
  markUpdateLaneFromFiberToRoot(sourceFiber, null, lane);
  return root;
}

// 从这个fiber开始到root标记更新车道 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function markUpdateLaneFromFiberToRoot(
  sourceFiber: Fiber,
  update: ConcurrentUpdate | null,
  lane: Lane,
): void {
  // Update the source fiber's lanes
  sourceFiber.lanes = mergeLanes(sourceFiber.lanes, lane); // 直接参数做一个或|运算 // ++++++++++++++++++++++++++++++
  let alternate = sourceFiber.alternate; // alternate
  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, lane); // 标记更新 // ++++++++++++++++++++++++++++++++++++++++++++
  }
  // alternate 对立面都要进行标记 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 将父路径走到根并更新子通道。 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // Walk the parent path to the root and update the child lanes.
  let isHidden = false;
  let parent = sourceFiber.return;
  let node = sourceFiber;

  // current和wip都是进行统一的操作的
  // 循环向上标记【childLanes】 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  while (parent !== null) {
    parent.childLanes = mergeLanes(parent.childLanes, lane); // ++++++++++++++++++++++++++++++++++++++++++
    alternate = parent.alternate;
    if (alternate !== null) {
      alternate.childLanes = mergeLanes(alternate.childLanes, lane); // +++++++++++++++++++++++++++++++++++++++++++++++++++++
    }

    if (parent.tag === OffscreenComponent) {
      // Check if this offscreen boundary is currently hidden.
      //
      // The instance may be null if the Offscreen parent was unmounted. Usually
      // the parent wouldn't be reachable in that case because we disconnect
      // fibers from the tree when they are deleted. However, there's a weird
      // edge case where setState is called on a fiber that was interrupted
      // before it ever mounted. Because it never mounts, it also never gets
      // deleted. Because it never gets deleted, its return pointer never gets
      // disconnected. Which means it may be attached to a deleted Offscreen
      // parent node. (This discovery suggests it may be better for memory usage
      // if we don't attach the `return` pointer until the commit phase, though
      // in order to do that we'd need some other way to track the return
      // pointer during the initial render, like on the stack.)
      //
      // This case is always accompanied by a warning, but we still need to
      // account for it. (There may be other cases that we haven't discovered,
      // too.)
      const offscreenInstance: OffscreenInstance | null = parent.stateNode;
      if (
        offscreenInstance !== null &&
        !(offscreenInstance._visibility & OffscreenVisible)
      ) {
        isHidden = true;
      }
    }

    node = parent;
    parent = parent.return;
  }

  if (isHidden && update !== null && node.tag === HostRoot) {
    const root: FiberRoot = node.stateNode;
    markHiddenUpdate(root, update, lane);
  }
}

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// 为更新fiber获取root
function getRootForUpdatedFiber(sourceFiber: Fiber): FiberRoot | null {
  // TODO: We will detect and infinite update loop and throw even if this fiber
  // has already unmounted. This isn't really necessary but it happens to be the
  // current behavior we've used for several release cycles. Consider not
  // performing this check if the updated fiber already unmounted, since it's
  // not possible for that to cause an infinite update loop.
  throwIfInfiniteUpdateLoopDetected();

  // When a setState happens, we must ensure the root is scheduled. Because
  // update queues do not have a backpointer to the root, the only way to do
  // this currently is to walk up the return path. This used to not be a big
  // deal because we would have to walk up the return path to set
  // the `childLanes`, anyway, but now those two traversals happen at
  // different times.
  // TODO: Consider adding a `root` backpointer on the update queue.
  detectUpdateOnUnmountedFiber(sourceFiber, sourceFiber);
  let node = sourceFiber;
  let parent = node.return; // 拿到它的return fiber

  // while循环
  while (parent !== null) {
    detectUpdateOnUnmountedFiber(sourceFiber, node);
    node = parent;
    parent = node.return; // 一直向上查找
  }
  // FiberNode没有return了 - 直接看它的tag是否为HostRoot然后返回它的stateNode - 其实就是FiberRootNode
  return node.tag === HostRoot ? (node.stateNode: FiberRoot) : null;
  // 其实就是返回FiberRootNode // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

function detectUpdateOnUnmountedFiber(sourceFiber: Fiber, parent: Fiber) {
  if (__DEV__) {
    const alternate = parent.alternate;
    if (
      alternate === null &&
      (parent.flags & (Placement | Hydrating)) !== NoFlags
    ) {
      warnAboutUpdateOnNotYetMountedFiberInDEV(sourceFiber);
    }
  }
}
