/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {SchedulerCallback} from './Scheduler';

import {
  DiscreteEventPriority,
  getCurrentUpdatePriority,
  setCurrentUpdatePriority,
} from './ReactEventPriorities.new';
import {ImmediatePriority, scheduleCallback} from './Scheduler';

// 同步队列
let syncQueue: Array<SchedulerCallback> | null = null; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
let includesLegacySyncCallbacks: boolean = false;
let isFlushingSyncQueue: boolean = false;

// 调度同步回调 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
export function scheduleSyncCallback(callback: SchedulerCallback) {
  // Push this callback into an internal queue. We'll flush these either in
  // the next tick, or earlier if something calls `flushSyncCallbackQueue`.
  if (syncQueue === null) {
    syncQueue = [callback]; // 一个数组存储起来 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  } else {
    // Push onto existing queue. Don't need to schedule a callback because
    // we already scheduled one when we created the queue.
    syncQueue.push(callback); // 推入进来 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }
}

export function scheduleLegacySyncCallback(callback: SchedulerCallback) {
  includesLegacySyncCallbacks = true;
  scheduleSyncCallback(callback);
}

export function flushSyncCallbacksOnlyInLegacyMode() {
  // Only flushes the queue if there's a legacy sync callback scheduled.
  // TODO: There's only a single type of callback: performSyncOnWorkOnRoot. So
  // it might make more sense for the queue to be a list of roots instead of a
  // list of generic callbacks. Then we can have two: one for legacy roots, one
  // for concurrent roots. And this method would only flush the legacy ones.
  if (includesLegacySyncCallbacks) {
    flushSyncCallbacks();
  }
}

// 刷新同步cbs // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function flushSyncCallbacks(): null {
  // 当前不是正在刷新同步队列 且 同步队列不为null // +++++++++++++++++++++++++++++++++++++++++++++++++++++++
  if (!isFlushingSyncQueue && syncQueue !== null) {
    // Prevent re-entrance.
    isFlushingSyncQueue = true; // 标记正在处理中 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    let i = 0;
    const previousUpdatePriority = getCurrentUpdatePriority(); // 获取当前更新优先级 // +++++++++++++++
    try {
      const isSync = true; // 是同步的 // +++++++++++++++++++++++++++++++++++++++++++++++++++
      const queue = syncQueue; // 赋值
      // TODO: Is this necessary anymore? The only user code that runs in this
      // queue is in the render or commit phases.
      setCurrentUpdatePriority(DiscreteEventPriority); // 设置当前更新优先级为离散事件优先级 - 也就是同步车道 1
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      // 遍历队列 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      for (; i < queue.length; i++) {
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        let callback: SchedulerCallback = queue[i]; // 取出cb // +++++++++++++++++++++++++++++++++

        // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
        do {
          // $FlowFixMe[incompatible-type] we bail out when we get a null
          callback = callback(isSync); // 传入true // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        } while (callback !== null); // 执行cb - 只要它返回的结果不为null，那么一直执行 // +++++++++++++++++++++++++++++++++++++++++++++++

      }
      // 清空同步队列 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      syncQueue = null;
      includesLegacySyncCallbacks = false;
    } catch (error) {
      // If something throws, leave the remaining callbacks on the queue.
      if (syncQueue !== null) {
        syncQueue = syncQueue.slice(i + 1);
      }
      // Resume flushing in the next tick
      scheduleCallback(ImmediatePriority, flushSyncCallbacks);
      throw error;
    } finally {
      // 恢复原来的当前更新优先级
      setCurrentUpdatePriority(previousUpdatePriority);
      // 恢复状态 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      isFlushingSyncQueue = false;
    }
  }

  // 返回null
  return null;
}
