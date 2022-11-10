/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Lane, Lanes} from './ReactFiberLane.new';

import {
  NoLane,
  SyncLane,
  InputContinuousLane,
  DefaultLane,
  IdleLane,
  getHighestPriorityLane,
  includesNonIdleWork,
} from './ReactFiberLane.new';

export opaque type EventPriority = Lane;

// 离散事件优先级
export const DiscreteEventPriority: EventPriority = SyncLane; // 同步车道 // 1 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// 连续事件优先级
export const ContinuousEventPriority: EventPriority = InputContinuousLane; // 4
// 默认事件优先级
export const DefaultEventPriority: EventPriority = DefaultLane; // 16
// 空闲事件优先级
export const IdleEventPriority: EventPriority = IdleLane; // 536870912

// 当前更新优先级
let currentUpdatePriority: EventPriority = NoLane; // 默认为NoLane

// 获取当前更新优先级
export function getCurrentUpdatePriority(): EventPriority {
  return currentUpdatePriority;
}

// 设置当前更新优先级
export function setCurrentUpdatePriority(newPriority: EventPriority) {
  currentUpdatePriority = newPriority;
}

export function runWithPriority<T>(priority: EventPriority, fn: () => T): T {
  const previousPriority = currentUpdatePriority;
  try {
    currentUpdatePriority = priority;
    return fn();
  } finally {
    currentUpdatePriority = previousPriority;
  }
}

export function higherEventPriority(
  a: EventPriority,
  b: EventPriority,
): EventPriority {
  return a !== 0 && a < b ? a : b;
}

// 降低事件优先级
export function lowerEventPriority(
  a: EventPriority,
  b: EventPriority,
): EventPriority {
  return a === 0 || a > b ? a : b;
}

// a < b
export function isHigherEventPriority(
  a: EventPriority,
  b: EventPriority,
): boolean {
  return a !== 0 && a < b;
}

// lanes转为事件优先级 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function lanesToEventPriority(lanes: Lanes): EventPriority {
  // 获取最高优先级
  const lane = getHighestPriorityLane(lanes);

  // DiscreteEventPriority < lane
  if (!isHigherEventPriority(DiscreteEventPriority, lane)) {
    return DiscreteEventPriority;
  }

  // ContinuousEventPriority < lane
  if (!isHigherEventPriority(ContinuousEventPriority, lane)) {
    return ContinuousEventPriority;
  }

  // 不包含IdleWork
  if (includesNonIdleWork(lane)) {
    return DefaultEventPriority;
  }

  // 包含IdleWork
  return IdleEventPriority;
}
