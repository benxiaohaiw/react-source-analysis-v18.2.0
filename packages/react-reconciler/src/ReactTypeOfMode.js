/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export type TypeOfMode = number;

// 0
export const NoMode = /*                         */ 0b000000;
// TODO: Remove ConcurrentMode by reading from the root tag instead
export const ConcurrentMode = /*                 */ 0b000001; // 1
export const ProfileMode = /*                    */ 0b000010; // 2
export const DebugTracingMode = /*               */ 0b000100; // 4
export const StrictLegacyMode = /*               */ 0b001000; // 8
export const StrictEffectsMode = /*              */ 0b010000; // 16
export const ConcurrentUpdatesByDefaultMode = /* */ 0b100000; // 32
