/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {enableCreateEventHandleAPI} from 'shared/ReactFeatureFlags';

export type Flags = number;

// Don't change these two values. They're used by React Dev Tools. // 下面两个值是被使用在react devTools中的 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export const NoFlags = /*                      */ 0b00000000000000000000000000; // 0
export const PerformedWork = /*                */ 0b00000000000000000000000001; // 1 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// You can change the rest (and add more).
export const Placement = /*                    */ 0b00000000000000000000000010; // 2 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export const Update = /*                       */ 0b00000000000000000000000100; // 4 // 这个是Update
export const ChildDeletion = /*                */ 0b00000000000000000000001000; // 8
export const ContentReset = /*                 */ 0b00000000000000000000010000; // 16
export const Callback = /*                     */ 0b00000000000000000000100000;
export const DidCapture = /*                   */ 0b00000000000000000001000000;
export const ForceClientRender = /*            */ 0b00000000000000000010000000;
export const Ref = /*                          */ 0b00000000000000000100000000;
export const Snapshot = /*                     */ 0b00000000000000001000000000; // 512 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export const Passive = /*                      */ 0b00000000000000010000000000; // 1024 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export const Hydrating = /*                    */ 0b00000000000000100000000000;
export const Visibility = /*                   */ 0b00000000000001000000000000;
export const StoreConsistency = /*             */ 0b00000000000010000000000000;

export const LifecycleEffectMask =
  Passive | Update | Callback | Ref | Snapshot | StoreConsistency;

// Union of all commit flags (flags with the lifetime of a particular commit)
export const HostEffectMask = /*               */ 0b00000000000011111111111111;

// These are not really side effects, but we still reuse this field.
export const Incomplete = /*                   */ 0b00000000000100000000000000;
export const ShouldCapture = /*                */ 0b00000000001000000000000000;
export const ForceUpdateForLegacySuspense = /* */ 0b00000000010000000000000000;
export const DidPropagateContext = /*          */ 0b00000000100000000000000000;
export const NeedsPropagation = /*             */ 0b00000001000000000000000000;
export const Forked = /*                       */ 0b00000010000000000000000000;

// Static tags describe aspects of a fiber that are not specific to a render,
// e.g. a fiber uses a passive effect (even if there are no updates on this particular render).
// This enables us to defer more work in the unmount case,
// since we can defer traversing the tree during layout to look for Passive effects,
// and instead rely on the static flag as a signal that there may be cleanup work.
export const RefStatic = /*                    */ 0b00000100000000000000000000;
export const LayoutStatic = /*                 */ 0b00001000000000000000000000;
export const PassiveStatic = /*                */ 0b00010000000000000000000000; // 4194304 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// Flag used to identify newly inserted fibers. It isn't reset after commit unlike `Placement`.
export const PlacementDEV = /*                 */ 0b00100000000000000000000000;
export const MountLayoutDev = /*               */ 0b01000000000000000000000000; // 16777216
export const MountPassiveDev = /*              */ 0b10000000000000000000000000; // 33554432 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// Groups of flags that are used in the commit phase to skip over trees that
// don't contain effects, by checking subtreeFlags.

export const BeforeMutationMask =
  // TODO: Remove Update flag from before mutation phase by re-landing Visibility
  // flag logic (see #20043)
  Update |
  Snapshot |
  (enableCreateEventHandleAPI
    ? // createEventHandle needs to visit deleted and hidden trees to
      // fire beforeblur
      // TODO: Only need to visit Deletions during BeforeMutation phase if an
      // element is focused.
      ChildDeletion | Visibility
    : 0);

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export const MutationMask = // 12854
  Placement | // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
  Update |
  ChildDeletion |
  ContentReset |
  Ref |
  Hydrating |
  Visibility;
export const LayoutMask = Update | Callback | Ref | Visibility; // 8772

// TODO: Split into PassiveMountMask and PassiveUnmountMask
export const PassiveMask = Passive | Visibility | ChildDeletion; // 2064

// Union of tags that don't get reset on clones.
// This allows certain concepts to persist without recalculating them,
// e.g. whether a subtree contains passive effects or portals.
export const StaticMask = LayoutStatic | PassiveStatic | RefStatic; // 14680064
