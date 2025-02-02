/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {Transition} from './ReactFiberTracingMarkerComponent.new';
import type {ConcurrentUpdate} from './ReactFiberConcurrentUpdates.new';

// TODO: Ideally these types would be opaque but that doesn't work well with
// our reconciler fork infra, since these leak into non-reconciler packages.

export type Lanes = number;
export type Lane = number;
export type LaneMap<T> = Array<T>;

import {
  enableSchedulingProfiler,
  enableUpdaterTracking,
  allowConcurrentByDefault,
  enableTransitionTracing,
} from 'shared/ReactFeatureFlags';
import {isDevToolsPresent} from './ReactFiberDevToolsHook.new';
import {ConcurrentUpdatesByDefaultMode, NoMode} from './ReactTypeOfMode';
import {clz32} from './clz32';

// Lane values below should be kept in sync with getLabelForLane(), used by react-devtools-timeline.
// If those values are changed that package should be rebuilt and redeployed.

export const TotalLanes = 31;

// 0
export const NoLanes: Lanes = /*                        */ 0b0000000000000000000000000000000;
// 0
export const NoLane: Lane = /*                          */ 0b0000000000000000000000000000000; // ++++++++++++++++++++++++++++++++++++++++++++++

// 1
export const SyncLane: Lane = /*                        */ 0b0000000000000000000000000000001; // +++++++++++++++++++++++++++++++++++++++++++++

export const InputContinuousHydrationLane: Lane = /*    */ 0b0000000000000000000000000000010;
// 4
export const InputContinuousLane: Lane = /*             */ 0b0000000000000000000000000000100; // ++++++++++++++++++++++++++++++++++++++++++++++

export const DefaultHydrationLane: Lane = /*            */ 0b0000000000000000000000000001000;
// 16
export const DefaultLane: Lane = /*                     */ 0b0000000000000000000000000010000; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

const TransitionHydrationLane: Lane = /*                */ 0b0000000000000000000000000100000;
const TransitionLanes: Lanes = /*                       */ 0b0000000001111111111111111000000; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
const TransitionLane1: Lane = /*                        */ 0b0000000000000000000000001000000; // 64 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
const TransitionLane2: Lane = /*                        */ 0b0000000000000000000000010000000;
const TransitionLane3: Lane = /*                        */ 0b0000000000000000000000100000000;
const TransitionLane4: Lane = /*                        */ 0b0000000000000000000001000000000;
const TransitionLane5: Lane = /*                        */ 0b0000000000000000000010000000000;
const TransitionLane6: Lane = /*                        */ 0b0000000000000000000100000000000;
const TransitionLane7: Lane = /*                        */ 0b0000000000000000001000000000000;
const TransitionLane8: Lane = /*                        */ 0b0000000000000000010000000000000;
const TransitionLane9: Lane = /*                        */ 0b0000000000000000100000000000000;
const TransitionLane10: Lane = /*                       */ 0b0000000000000001000000000000000;
const TransitionLane11: Lane = /*                       */ 0b0000000000000010000000000000000;
const TransitionLane12: Lane = /*                       */ 0b0000000000000100000000000000000;
const TransitionLane13: Lane = /*                       */ 0b0000000000001000000000000000000;
const TransitionLane14: Lane = /*                       */ 0b0000000000010000000000000000000;
const TransitionLane15: Lane = /*                       */ 0b0000000000100000000000000000000;
const TransitionLane16: Lane = /*                       */ 0b0000000001000000000000000000000;

const RetryLanes: Lanes = /*                            */ 0b0000111110000000000000000000000; // +++
const RetryLane1: Lane = /*                             */ 0b0000000010000000000000000000000; // +++
const RetryLane2: Lane = /*                             */ 0b0000000100000000000000000000000; // +++
const RetryLane3: Lane = /*                             */ 0b0000001000000000000000000000000;
const RetryLane4: Lane = /*                             */ 0b0000010000000000000000000000000;
const RetryLane5: Lane = /*                             */ 0b0000100000000000000000000000000;

export const SomeRetryLane: Lane = RetryLane1;

export const SelectiveHydrationLane: Lane = /*          */ 0b0001000000000000000000000000000;

const NonIdleLanes: Lanes = /*                          */ 0b0001111111111111111111111111111;

export const IdleHydrationLane: Lane = /*               */ 0b0010000000000000000000000000000;
// 536870912
export const IdleLane: Lane = /*                        */ 0b0100000000000000000000000000000; // ++++++++++++++++++++++++++++++++++++++++++++

export const OffscreenLane: Lane = /*                   */ 0b1000000000000000000000000000000;

// This function is used for the experimental timeline (react-devtools-timeline)
// It should be kept in sync with the Lanes values above.
export function getLabelForLane(lane: Lane): string | void {
  if (enableSchedulingProfiler) {
    if (lane & SyncLane) {
      return 'Sync';
    }
    if (lane & InputContinuousHydrationLane) {
      return 'InputContinuousHydration';
    }
    if (lane & InputContinuousLane) {
      return 'InputContinuous';
    }
    if (lane & DefaultHydrationLane) {
      return 'DefaultHydration';
    }
    if (lane & DefaultLane) {
      return 'Default';
    }
    if (lane & TransitionHydrationLane) {
      return 'TransitionHydration';
    }
    if (lane & TransitionLanes) {
      return 'Transition';
    }
    if (lane & RetryLanes) {
      return 'Retry';
    }
    if (lane & SelectiveHydrationLane) {
      return 'SelectiveHydration';
    }
    if (lane & IdleHydrationLane) {
      return 'IdleHydration';
    }
    if (lane & IdleLane) {
      return 'Idle';
    }
    if (lane & OffscreenLane) {
      return 'Offscreen';
    }
  }
}

export const NoTimestamp = -1;

// +++
let nextTransitionLane: Lane = TransitionLane1; // +++
let nextRetryLane: Lane = RetryLane1; // +++
// +++

// +++
// 获取最高优先级车道集合 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function getHighestPriorityLanes(lanes: Lanes | Lane): Lanes { // +++
  /* 
  export function getHighestPriorityLane(lanes: Lanes): Lane {
    return lanes & -lanes;
  }
  */
  // +++
  switch (getHighestPriorityLane(lanes)) { // +++
    case SyncLane: // +++
      return SyncLane; // 1 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    
    case InputContinuousHydrationLane:
      return InputContinuousHydrationLane; // +++
    
    case InputContinuousLane:
      return InputContinuousLane; // +++
    
    case DefaultHydrationLane:
      return DefaultHydrationLane; // +++
    
    case DefaultLane:
      return DefaultLane; // 16 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    
    case TransitionHydrationLane:
      return TransitionHydrationLane; // +++
    
    // +++
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
    case TransitionLane16:
      return lanes & TransitionLanes; // +++
    
    // +++
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
    case RetryLane5:
      return lanes & RetryLanes; // +++
    
    // +++
    case SelectiveHydrationLane:
      return SelectiveHydrationLane; // +++
    case IdleHydrationLane:
      return IdleHydrationLane; // +++
    case IdleLane:
      return IdleLane; // +++
    case OffscreenLane:
      return OffscreenLane; // +++

    // +++
    default:
      if (__DEV__) {
        console.error(
          'Should have found matching lanes. This is a bug in React.',
        );
      }
      // This shouldn't be reachable, but as a fallback, return the entire bitmask.
      return lanes;
  }
}

// 获取下一车道集合 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function getNextLanes(root: FiberRoot, wipLanes: Lanes): Lanes { // +++
  // 如果没有未完成的工作，则提早救助。
  // Early bailout if there's no pending work left.

  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // 在packages/react-reconciler/src/ReactFiberWorkLoop.new.js下的scheduleUpdateOnFiber -> markRootUpdated（root.pendingLanes |= lane）做的
  const pendingLanes = root.pendingLanes; // root上的待处理车道集合 // +++++++++++++++++++++++++++++++++++++++++++=
  // +++

  // dispatchSetState -> scheduleUpdateOnFiber -> markRootUpdated

  // pendingLanes上保存了所有将要执行的任务的lane，如果pendingLanes为空，那么则表示任务全部执行完成，也就不需要更新了，直接跳出。
  // +++
  if (pendingLanes === NoLanes) {
    return NoLanes; // +++
  }

  // +++
  let nextLanes = NoLanes;

  // +++
  // 在当前文件中的markRootUpdated函数中有 - 大概率都是0
  const suspendedLanes = root.suspendedLanes; // 已挂起车道集合 - finishConcurrentRender -> markRootSuspended
  const pingedLanes = root.pingedLanes; // 已ping车道集合 - workLoopConcurrent -> resumeSuspendedUnitOfWork -> throwException（packages/react-reconciler/src/ReactFiberThrow.new.js） -> attachPingListener -> pingSuspendedRoot -> markRootPinged
  // +++

  // +++
  // 不要做任何空闲的工作，直到所有非空闲的工作都完成，即使工作是挂起的。
  // Do not work on any idle work until all the non-idle work has finished,
  // even if the work is suspended.
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // const NonIdleLanes: Lanes = /*                          */ 0b0001111111111111111111111111111;
  const nonIdlePendingLanes = pendingLanes & NonIdleLanes; // 比如拿16或1 & 这个东东，那结果还是pendingLanes 16或1
  // 待处理车道集合 & 非空闲车道集合 -> 非空闲待处理车道集合

  // 是非空闲待处理车道集合
  if (nonIdlePendingLanes !== NoLanes) {
    // 非空闲待处理车道集合 & 非已挂起车道集合 -> 非空闲非阻塞车道集合
    const nonIdleUnblockedLanes = nonIdlePendingLanes & ~suspendedLanes;

    // 是非空闲非阻塞车道集合
    if (nonIdleUnblockedLanes !== NoLanes) { // 还是16或1

      // 获取最高优先级车道集合
      nextLanes = getHighestPriorityLanes(nonIdleUnblockedLanes); // 16或1

    // 是非空闲但不是非阻塞车道集合
    } else {
      // 非空闲待处理车道集合 & 已ping车道集合 -> 非空闲已ping车道集合
      const nonIdlePingedLanes = nonIdlePendingLanes & pingedLanes;

      // 是非空闲已ping车道集合
      if (nonIdlePingedLanes !== NoLanes) {
        // 获取最高优先级车道集合
        nextLanes = getHighestPriorityLanes(nonIdlePingedLanes);
      }
    }
    // +++

    // suspendedLanes -> 意为阻塞车道集合

  // 是空闲车道待处理集合
  } else {
    // 唯一剩下的工作是空闲的。
    // The only remaining work is Idle.
    // 空闲车道待处理集合 & 非已挂起车道集合 -> 空闲非阻塞车道集合
    const unblockedLanes = pendingLanes & ~suspendedLanes;

    // 是空闲非阻塞车道集合
    if (unblockedLanes !== NoLanes) {
      // 获取最高优先级车道集合
      nextLanes = getHighestPriorityLanes(unblockedLanes);

    // 空闲但不是非阻塞车道集合
    } else {
      // 是否有已ping车道集合
      if (pingedLanes !== NoLanes) {
        // 获取最高优先级车道集合
        nextLanes = getHighestPriorityLanes(pingedLanes);
      }
    }
  }

  // +++
  if (nextLanes === NoLanes) {
    // 这应该只有在我们被挂起时才能访问
    // This should only be reachable if we're suspended
    // TODO: Consider warning in this path if a fallback timer is not scheduled.
    return NoLanes;
  }

  // +++
  // 正常wipLanes传过来是为0的 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 如果我们已经在渲染的中间，切换车道会中断渲染，我们会失去进度。只有在新车道优先级更高的情况下，我们才应该这么做。
  // If we're already in the middle of a render, switching lanes will interrupt
  // it and we'll lose our progress. We should only do this if the new lanes are
  // higher priority.
  if (
    wipLanes !== NoLanes &&
    wipLanes !== nextLanes &&
    // 如果我们已经带有延时的挂起了，那么打断是可以的。不要等待root完成。
    // If we already suspended with a delay, then interrupting is fine. Don't
    // bother waiting until the root is complete.
    (wipLanes & suspendedLanes) === NoLanes // wipLanes不是suspendedLanes
  ) {
    // 获取最高优先级车道
    const nextLane = getHighestPriorityLane(nextLanes);
    const wipLane = getHighestPriorityLane(wipLanes);
    if (
      // 测试下一个通道的优先级是否等于或低于wip通道。这是因为当你向左走的时候，比特的优先级就会降低。
      // Tests whether the next lane is equal or lower priority than the wip
      // one. This works because the bits decrease in priority as you go left.
      nextLane >= wipLane ||
      // 默认优先级更新不应该中断transition更新。默认更新和transition更新之间的唯一区别是，默认更新不支持refresh transition。
      // Default priority updates should not interrupt transition updates. The
      // only difference between default updates and transition updates is that
      // default updates do not support refresh transitions.
      (nextLane === DefaultLane && (wipLane & TransitionLanes) !== NoLanes)
    ) {
      // 继续处理现有的正在进行的树。不要打扰。
      // Keep working on the existing in-progress tree. Do not interrupt.
      return wipLanes;
    }
  }

  // +++
  if (
    // 通过默认允许并发
    // shared/ReactFeatureFlags
    allowConcurrentByDefault &&
    // root.current.mode是ConcurrentUpdatesByDefaultMode模式
    (root.current.mode & ConcurrentUpdatesByDefaultMode) !== NoMode
  ) {
    // 什么都不做，使用分配给他们的车道。
    // Do nothing, use the lanes as they were assigned.
  } else if ((nextLanes & InputContinuousLane /** 输入连续车道 // ++++++++++++++++++++++= */) !== NoLanes) { // 按照上面的16或1来讲结果这里为false
    // nextLanes是InputContinuousLane

    // +++
    // 当更新默认为同步时，【我们将连续的优先级更新和默认更新纠缠在一起，因此它们在同一批中渲染】。 // +++它们使用单独通道的唯一原因是连续更新应该中断transitions，但默认更新不应该。
    // +++
    // When updates are sync by default, we entangle continuous priority updates
    // and default updates, so they render in the same batch. The only reason
    // they use separate lanes is because continuous updates should interrupt
    // transitions, but default updates should not.
    nextLanes |= pendingLanes & DefaultLane; // 将InputContinuousLane和DefaultLane纠缠在一起，因此它们在同一批中渲染。
  }

  // +++
  // 【检查纠缠的车道并将它们添加到批次中】。 // +++
  // 
  // 当不允许在不包括另一个车道的批处理中渲染时，一个车道被称为与另一个车道纠缠。通常情况下，当多个更新具有相同的源，并且我们只想响应来自该源的最新事件时，我们会这样做。
  // 
  // 注意，我们应用纠缠 *after* 检查上述部分工作。
  // 这意味着，如果一个车道在交错的事件中被纠缠，而它已经在渲染，我们不会中断它。
  // 这是有意为之的，因为纠缠通常是“尽最大努力”：我们会尽最大努力在同一批中渲染通道，但为了这样做而放弃部分已完成的工作是不值得的。
  // 待办：重新考虑一下。相反的观点是，部分工作代表中间状态，我们不想显示给用户。通过花额外的时间完成它，我们增加了显示最终状态所需的时间，这是他们真正等待的。
  // 
  // 对于那些纠缠在语义上很重要的例外情况，比如useMutableSource，我们应该确保在应用纠缠时没有部分工作。
  // +++

  // Check for entangled lanes and add them to the batch.
  //
  // A lane is said to be entangled with another when it's not allowed to render
  // in a batch that does not also include the other lane. Typically we do this
  // when multiple updates have the same source, and we only want to respond to
  // the most recent event from that source.
  //
  // Note that we apply entanglements *after* checking for partial work above.
  // This means that if a lane is entangled during an interleaved event while
  // it's already rendering, we won't interrupt it. This is intentional, since
  // entanglement is usually "best effort": we'll try our best to render the
  // lanes in the same batch, but it's not worth throwing out partially
  // completed work in order to do it.
  // TODO: Reconsider this. The counter-argument is that the partial work
  // represents an intermediate state, which we don't want to show to the user.
  // And by spending extra time finishing it, we're increasing the amount of
  // time it takes to show the final state, which is what they are actually
  // waiting for.
  //
  // For those exceptions where entanglement is semantically important, like
  // useMutableSource, we should ensure that there is no partial work at the
  // time we apply the entanglement.
  const entangledLanes = root.entangledLanes; // +++ - dispatchSetState -> entangleTransitionUpdate -> markRootEntangled
  if (entangledLanes !== NoLanes) { // +++
    const entanglements = root.entanglements; // ++
    let lanes = nextLanes & entangledLanes; // +++

    /* 
    entangledLanes: 纠缠车道集合
    entanglements: 纠缠元素数组
    */

    // +++
    while (lanes > 0) {
      // +++
      /* 
        // 获取当前lanes中最左边1的位置
        // 例如：
        // lanes = 28 = 0b0000000000000000000000000011100
        // 以32位正常看的话，最左边的1应该是在5的位置上
        // 但是lanes设置了总长度为31，所以我们可以也减1，看作在4的位置上
        // 如果这样不好理解的话，可以看pickArbitraryLaneIndex中的源码：
        // 31 - clz32(lanes), clz32是Math中的一个API，获取的是最左边1前面的所有0的个数

        // 27 = Math.clz32(28);

        // +++
        链接：https://juejin.cn/post/7008802041602506765
      */
      const index = pickArbitraryLaneIndex(lanes); // pickArbitraryLaneIndex: 挑选随意的车道下标 // +++

      // +++
      /* 
        // 上面获取到最左边1的位置后，还需要获取到这个位置上的值
        // index = 4
        // 16 = 10000 = 1 << 4
      */
      const lane = 1 << index;

      // +++
      nextLanes |= entanglements[index]; // +++
      // 纠缠在一起

      // +++
      lanes &= ~lane;
    }
  }

  // +++
  return nextLanes; // 正常情况下还是返回16或1的 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

export function getMostRecentEventTime(root: FiberRoot, lanes: Lanes): number {
  const eventTimes = root.eventTimes;

  let mostRecentEventTime = NoTimestamp;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    const eventTime = eventTimes[index];
    if (eventTime > mostRecentEventTime) {
      mostRecentEventTime = eventTime;
    }

    lanes &= ~lane;
  }

  return mostRecentEventTime;
}

function computeExpirationTime(lane: Lane, currentTime: number) {
  switch (lane) {
    case SyncLane:
    case InputContinuousHydrationLane:
    case InputContinuousLane:
      // User interactions should expire slightly more quickly.
      //
      // NOTE: This is set to the corresponding constant as in Scheduler.js.
      // When we made it larger, a product metric in www regressed, suggesting
      // there's a user interaction that's being starved by a series of
      // synchronous updates. If that theory is correct, the proper solution is
      // to fix the starvation. However, this scenario supports the idea that
      // expiration times are an important safeguard when starvation
      // does happen.
      return currentTime + 250;
    case DefaultHydrationLane:
    case DefaultLane:
    case TransitionHydrationLane:
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
    case TransitionLane16:
      return currentTime + 5000;
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
    case RetryLane5:
      // TODO: Retries should be allowed to expire if they are CPU bound for
      // too long, but when I made this change it caused a spike in browser
      // crashes. There must be some other underlying bug; not super urgent but
      // ideally should figure out why and fix it. Unfortunately we don't have
      // a repro for the crashes, only detected via production metrics.
      return NoTimestamp;
    case SelectiveHydrationLane:
    case IdleHydrationLane:
    case IdleLane:
    case OffscreenLane:
      // Anything idle priority or lower should never expire.
      return NoTimestamp;
    default:
      if (__DEV__) {
        console.error(
          'Should have found matching lanes. This is a bug in React.',
        );
      }
      return NoTimestamp;
  }
}

export function markStarvedLanesAsExpired(
  root: FiberRoot,
  currentTime: number,
): void {
  // TODO: This gets called every time we yield. We can optimize by storing
  // the earliest expiration time on the root. Then use that to quickly bail out
  // of this function.

  const pendingLanes = root.pendingLanes;
  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;
  const expirationTimes = root.expirationTimes;

  // Iterate through the pending lanes and check if we've reached their
  // expiration time. If so, we'll assume the update is being starved and mark
  // it as expired to force it to finish.
  //
  // We exclude retry lanes because those must always be time sliced, in order
  // to unwrap uncached promises.
  // TODO: Write a test for this
  let lanes = pendingLanes & ~RetryLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    const expirationTime = expirationTimes[index];
    if (expirationTime === NoTimestamp) {
      // Found a pending lane with no expiration time. If it's not suspended, or
      // if it's pinged, assume it's CPU-bound. Compute a new expiration time
      // using the current time.
      if (
        (lane & suspendedLanes) === NoLanes ||
        (lane & pingedLanes) !== NoLanes
      ) {
        // Assumes timestamps are monotonically increasing.
        expirationTimes[index] = computeExpirationTime(lane, currentTime);
      }
    } else if (expirationTime <= currentTime) {
      // This lane expired
      root.expiredLanes |= lane;
    }

    lanes &= ~lane;
  }
}

// This returns the highest priority pending lanes regardless of whether they
// are suspended.
export function getHighestPriorityPendingLanes(root: FiberRoot): Lanes {
  return getHighestPriorityLanes(root.pendingLanes);
}

export function getLanesToRetrySynchronouslyOnError(
  root: FiberRoot,
  originallyAttemptedLanes: Lanes,
): Lanes {
  if (root.errorRecoveryDisabledLanes & originallyAttemptedLanes) {
    // The error recovery mechanism is disabled until these lanes are cleared.
    return NoLanes;
  }

  const everythingButOffscreen = root.pendingLanes & ~OffscreenLane;
  if (everythingButOffscreen !== NoLanes) {
    return everythingButOffscreen;
  }
  if (everythingButOffscreen & OffscreenLane) {
    return OffscreenLane;
  }
  return NoLanes;
}

// 是否包含同步车道
export function includesSyncLane(lanes: Lanes): boolean {
  return (lanes & SyncLane) !== NoLanes; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

export function includesNonIdleWork(lanes: Lanes): boolean {
  return (lanes & NonIdleLanes) !== NoLanes;
}

// 是否只包含重试车道集合 // +++
export function includesOnlyRetries(lanes: Lanes): boolean {
  return (lanes & RetryLanes) === lanes; // +++
}


// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function includesOnlyNonUrgentLanes(lanes: Lanes): boolean {
  const UrgentLanes = SyncLane | InputContinuousLane | DefaultLane;
  return (lanes & UrgentLanes) === NoLanes;
}


// 是否只包含过渡车道集合 // +++
export function includesOnlyTransitions(lanes: Lanes): boolean {
  return (lanes & TransitionLanes) === lanes; // +++
  // ++++++
}

// 是否包含阻塞车道 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function includesBlockingLane(root: FiberRoot, lanes: Lanes): boolean {
  if (
    allowConcurrentByDefault &&
    (root.current.mode & ConcurrentUpdatesByDefaultMode) !== NoMode
  ) {
    // 默认情况下，并发更新始终使用时间片。
    // Concurrent updates by default always use time slicing.
    return false; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }

  // 同步默认车道集合
  const SyncDefaultLanes =
    InputContinuousHydrationLane |
    InputContinuousLane |
    DefaultHydrationLane |
    DefaultLane; // 16 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return (lanes & SyncDefaultLanes) !== NoLanes; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

// 是否包含root的过期车道集合 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function includesExpiredLane(root: FiberRoot, lanes: Lanes): boolean {
  // This is a separate check from includesBlockingLane because a lane can
  // expire after a render has already started.
  return (lanes & root.expiredLanes) !== NoLanes; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

// 是否为过渡车道集合 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function isTransitionLane(lane: Lane): boolean {
  // const TransitionLanes: Lanes = /*                       */ 0b0000000001111111111111111000000; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
  return (lane & TransitionLanes) !== NoLanes;
}

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=++++++++++++
export function claimNextTransitionLane(): Lane { // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // Cycle through the lanes, assigning each new transition to the next lane.
  // In most cases, this means every transition gets its own lane, until we
  // run out of lanes and cycle back to the beginning.
  const lane = nextTransitionLane; // nextTransitionLane默认就是TransitionLane1
  nextTransitionLane <<= 1; // 左移
  if ((nextTransitionLane & TransitionLanes) === NoLanes) {
    nextTransitionLane = TransitionLane1; // 回到TransitionLane1这个值
  }
  return lane; // TransitionLane1 64
}

// 要求下一个retry车道 // +++
export function claimNextRetryLane(): Lane {
  const lane = nextRetryLane; // nextRetryLane默认是RetryLane1

  nextRetryLane <<= 1; // 左移 - 变为RetryLane2
  
  if ((nextRetryLane & RetryLanes) === NoLanes) { // 若左移之后不再属于RetryLanes了则回归默认值边界RetryLane1
    nextRetryLane = RetryLane1;
  }

  // 返回这个车道
  return lane; // RetryLane1
}

// +++
// 获取最高优先级车道
export function getHighestPriorityLane(lanes: Lanes): Lane {
  // +++
  return lanes & -lanes; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}
// +++

// +++
// 挑选随意的车道
export function pickArbitraryLane(lanes: Lanes): Lane {
  // This wrapper function gets inlined. Only exists so to communicate that it
  // doesn't matter which bit is selected; you can pick any bit without
  // affecting the algorithms where its used. Here I'm using
  // getHighestPriorityLane because it requires the fewest operations.
  return getHighestPriorityLane(lanes); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

// +++
// 挑选随意的车道下标 // +++
function pickArbitraryLaneIndex(lanes: Lanes) {
  // +++
  return 31 - clz32(lanes); // +++
}

function laneToIndex(lane: Lane) {
  return pickArbitraryLaneIndex(lane);
}

// 是否包含一些车道
export function includesSomeLane(a: Lanes | Lane, b: Lanes | Lane): boolean {
  return (a & b) !== NoLanes; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

// 子集 // +++
export function isSubsetOfLanes(set: Lanes, subset: Lanes | Lane): boolean {
  return (set & subset) === subset; // +++
}

// 合并车道 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function mergeLanes(a: Lanes | Lane, b: Lanes | Lane): Lanes {
  return a | b;
}

// 删除车道集合 // +++
export function removeLanes(set: Lanes, subset: Lanes | Lane): Lanes {
  return set & ~subset;
}

// 交叉车道集合 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function intersectLanes(a: Lanes | Lane, b: Lanes | Lane): Lanes {
  return a & b; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

// Seems redundant, but it changes the type from a single lane (used for
// updates) to a group of lanes (used for flushing work).
export function laneToLanes(lane: Lane): Lanes {
  return lane;
}

export function higherPriorityLane(a: Lane, b: Lane): Lane {
  // This works because the bit ranges decrease in priority as you go left.
  return a !== NoLane && a < b ? a : b;
}

export function createLaneMap<T>(initial: T): LaneMap<T> {
  // Intentionally pushing one by one.
  // https://v8.dev/blog/elements-kinds#avoid-creating-holes
  const laneMap = [];
  for (let i = 0; i < TotalLanes; i++) {
    laneMap.push(initial);
  }
  return laneMap;
}

// +++
// 标记root有一个【待处理的更新】 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function markRootUpdated(
  root: FiberRoot,
  updateLane: Lane,
  eventTime: number,
) {

  // +++
  /// ++++++
  root.pendingLanes |= updateLane; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // If there are any suspended transitions, it's possible this new update
  // could unblock them. Clear the suspended lanes so that we can try rendering
  // them again.
  //
  // TODO: We really only need to unsuspend only lanes that are in the
  // `subtreeLanes` of the updated fiber, or the update lanes of the return
  // path. This would exclude suspended updates in an unrelated sibling tree,
  // since there's no way for this update to unblock it.
  //
  // We don't do this if the incoming update is idle, because we never process
  // idle updates until after all the regular updates have finished; there's no
  // way it could unblock a transition.
  if (updateLane !== IdleLane) { // 不是空闲车道 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    root.suspendedLanes = NoLanes; // 0
    root.pingedLanes = NoLanes; // 0
  }

  const eventTimes = root.eventTimes;
  const index = laneToIndex(updateLane);
  // We can always overwrite an existing timestamp because we prefer the most
  // recent event, and we assume time is monotonically increasing.
  eventTimes[index] = eventTime;
}


// +++
// 标记root已挂起 // +++
export function markRootSuspended(root: FiberRoot, suspendedLanes: Lanes) {

  // +++
  root.suspendedLanes |= suspendedLanes; // +++
  root.pingedLanes &= ~suspendedLanes; // +++
  // +++

  // +++
  // The suspended lanes are no longer CPU-bound. Clear their expiration times.
  const expirationTimes = root.expirationTimes; // +++
  let lanes = suspendedLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    expirationTimes[index] = NoTimestamp; // +++

    lanes &= ~lane;
  }
}


// +++
// 标记root已ping // +++
export function markRootPinged(
  root: FiberRoot,
  pingedLanes: Lanes,
  eventTime: number,
) {
  /// +++
  root.pingedLanes |= root.suspendedLanes & pingedLanes; // ++++++
}

export function markRootMutableRead(root: FiberRoot, updateLane: Lane) {
  root.mutableReadLanes |= updateLane & root.pendingLanes;
}

// +++
// 标记root已完成 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function markRootFinished(root: FiberRoot, remainingLanes: Lanes) {
  const noLongerPendingLanes = root.pendingLanes & ~remainingLanes;

  // +++
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  root.pendingLanes = remainingLanes; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // +++

  // +++
  // 让我们再试一次
  // Let's try everything again
  root.suspendedLanes = NoLanes;
  root.pingedLanes = NoLanes;

  root.expiredLanes &= remainingLanes;
  root.mutableReadLanes &= remainingLanes;

  // +++
  root.entangledLanes &= remainingLanes; // +++
  // +++

  root.errorRecoveryDisabledLanes &= remainingLanes;

  // +++
  const entanglements = root.entanglements; // +++
  const eventTimes = root.eventTimes;
  const expirationTimes = root.expirationTimes;
  const hiddenUpdates = root.hiddenUpdates;
  // +++

  // +++
  // 清除不再有待处理工作的通道 // +++
  // Clear the lanes that no longer have pending work
  let lanes = noLongerPendingLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    entanglements[index] = NoLanes;
    eventTimes[index] = NoTimestamp;
    expirationTimes[index] = NoTimestamp;

    const hiddenUpdatesForLane = hiddenUpdates[index];
    if (hiddenUpdatesForLane !== null) {
      hiddenUpdates[index] = null;
      // "Hidden" updates are updates that were made to a hidden component. They
      // have special logic associated with them because they may be entangled
      // with updates that occur outside that tree. But once the outer tree
      // commits, they behave like regular updates.
      for (let i = 0; i < hiddenUpdatesForLane.length; i++) {
        const update = hiddenUpdatesForLane[i];
        if (update !== null) {
          update.lane &= ~OffscreenLane;
        }
      }
    }

    lanes &= ~lane;
  }

  // +++
}

// +++
// 标记root已纠缠 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function markRootEntangled(root: FiberRoot, entangledLanes: Lanes) { // +++
  // In addition to entangling each of the given lanes with each other, we also
  // have to consider _transitive_ entanglements. For each lane that is already
  // entangled with *any* of the given lanes, that lane is now transitively
  // entangled with *all* the given lanes.
  //
  // Translated: If C is entangled with A, then entangling A with B also
  // entangles C with B.
  //
  // If this is hard to grasp, it might help to intentionally break this
  // function and look at the tests that fail in ReactTransition-test.js. Try
  // commenting out one of the conditions below.

  // +++
  const rootEntangledLanes = (root.entangledLanes |= entangledLanes); // ++++++++++++++++++++++++++++++++++++++++++++++++++
  // +++

  // +++
  const entanglements = root.entanglements; // +++
  // +++
  let lanes = rootEntangledLanes;
  // +++

  // +++
  while (lanes) {
    const index = pickArbitraryLaneIndex(lanes); // +++
    const lane = 1 << index; // +++

    // +++
    if (
      // 这是新纠缠的车道之一吗？
      // Is this one of the newly entangled lanes?
      (lane & entangledLanes) |
      // 这条车道是否与新纠缠的车道传递纠缠？
      // Is this lane transitively entangled with the newly entangled lanes?
      (entanglements[index] & entangledLanes)
    ) {

      // 将在getNextLanes函数中起作用 // +++
      // +++ 存入 // +++
      entanglements[index] |= entangledLanes;
    }
    lanes &= ~lane;
  }
}

export function markHiddenUpdate(
  root: FiberRoot,
  update: ConcurrentUpdate,
  lane: Lane,
) {
  const index = laneToIndex(lane);
  const hiddenUpdates = root.hiddenUpdates;
  const hiddenUpdatesForLane = hiddenUpdates[index];
  if (hiddenUpdatesForLane === null) {
    hiddenUpdates[index] = [update];
  } else {
    hiddenUpdatesForLane.push(update);
  }
  update.lane = lane | OffscreenLane;
}

export function getBumpedLaneForHydration(
  root: FiberRoot,
  renderLanes: Lanes,
): Lane {
  const renderLane = getHighestPriorityLane(renderLanes);

  let lane;
  switch (renderLane) {
    case InputContinuousLane:
      lane = InputContinuousHydrationLane;
      break;
    case DefaultLane:
      lane = DefaultHydrationLane;
      break;
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
    case TransitionLane16:
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
    case RetryLane5:
      lane = TransitionHydrationLane;
      break;
    case IdleLane:
      lane = IdleHydrationLane;
      break;
    default:
      // Everything else is already either a hydration lane, or shouldn't
      // be retried at a hydration lane.
      lane = NoLane;
      break;
  }

  // Check if the lane we chose is suspended. If so, that indicates that we
  // already attempted and failed to hydrate at that level. Also check if we're
  // already rendering that lane, which is rare but could happen.
  if ((lane & (root.suspendedLanes | renderLanes)) !== NoLane) {
    // Give up trying to hydrate and fall back to client render.
    return NoLane;
  }

  return lane;
}

export function addFiberToLanesMap(
  root: FiberRoot,
  fiber: Fiber,
  lanes: Lanes | Lane,
) {
  if (!enableUpdaterTracking) {
    return;
  }
  if (!isDevToolsPresent) {
    return;
  }
  const pendingUpdatersLaneMap = root.pendingUpdatersLaneMap;
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;

    const updaters = pendingUpdatersLaneMap[index];
    updaters.add(fiber);

    lanes &= ~lane;
  }
}

export function movePendingFibersToMemoized(root: FiberRoot, lanes: Lanes) {
  if (!enableUpdaterTracking) {
    return;
  }
  if (!isDevToolsPresent) {
    return;
  }
  const pendingUpdatersLaneMap = root.pendingUpdatersLaneMap;
  const memoizedUpdaters = root.memoizedUpdaters;
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;

    const updaters = pendingUpdatersLaneMap[index];
    if (updaters.size > 0) {
      updaters.forEach(fiber => {
        const alternate = fiber.alternate;
        if (alternate === null || !memoizedUpdaters.has(alternate)) {
          memoizedUpdaters.add(fiber);
        }
      });
      updaters.clear();
    }

    lanes &= ~lane;
  }
}

export function addTransitionToLanesMap(
  root: FiberRoot,
  transition: Transition,
  lane: Lane,
) {
  if (enableTransitionTracing) {
    const transitionLanesMap = root.transitionLanes;
    const index = laneToIndex(lane);
    let transitions = transitionLanesMap[index];
    if (transitions === null) {
      transitions = new Set();
    }
    transitions.add(transition);

    transitionLanesMap[index] = transitions;
  }
}

export function getTransitionsForLanes(
  root: FiberRoot,
  lanes: Lane | Lanes,
): Array<Transition> | null {
  if (!enableTransitionTracing) {
    return null;
  }

  const transitionsForLanes = [];
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;
    const transitions = root.transitionLanes[index];
    if (transitions !== null) {
      transitions.forEach(transition => {
        transitionsForLanes.push(transition);
      });
    }

    lanes &= ~lane;
  }

  if (transitionsForLanes.length === 0) {
    return null;
  }

  return transitionsForLanes;
}

export function clearTransitionsForLanes(root: FiberRoot, lanes: Lane | Lanes) {
  if (!enableTransitionTracing) {
    return;
  }

  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;

    const transitions = root.transitionLanes[index];
    if (transitions !== null) {
      root.transitionLanes[index] = null;
    }

    lanes &= ~lane;
  }
}
