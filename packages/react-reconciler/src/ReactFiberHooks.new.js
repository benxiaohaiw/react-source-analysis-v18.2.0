/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  MutableSource,
  MutableSourceGetSnapshotFn,
  MutableSourceSubscribeFn,
  ReactContext,
  StartTransitionOptions,
  Usable,
  Thenable,
} from 'shared/ReactTypes';
import type {
  Fiber,
  FiberRoot,
  Dispatcher,
  HookType,
  MemoCache,
} from './ReactInternalTypes';
import type {Lanes, Lane} from './ReactFiberLane.new';
import type {HookFlags} from './ReactHookEffectTags';
import type {Flags} from './ReactFiberFlags';

import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  enableDebugTracing,
  enableSchedulingProfiler,
  enableNewReconciler,
  enableCache,
  enableUseRefAccessWarning,
  enableLazyContextPropagation,
  enableUseMutableSource,
  enableTransitionTracing,
  enableUseHook,
  enableUseMemoCacheHook,
  enableUseEventHook,
  enableLegacyCache,
} from 'shared/ReactFeatureFlags';
import {
  REACT_CONTEXT_TYPE,
  REACT_SERVER_CONTEXT_TYPE,
  REACT_MEMO_CACHE_SENTINEL,
} from 'shared/ReactSymbols';

import {
  NoMode,
  ConcurrentMode,
  DebugTracingMode,
  StrictEffectsMode,
} from './ReactTypeOfMode';
import {
  NoLane,
  SyncLane,
  OffscreenLane,
  NoLanes,
  isSubsetOfLanes,
  includesBlockingLane,
  includesOnlyNonUrgentLanes,
  claimNextTransitionLane,
  mergeLanes,
  removeLanes,
  intersectLanes,
  isTransitionLane,
  markRootEntangled,
  markRootMutableRead,
  NoTimestamp,
} from './ReactFiberLane.new';
import {
  ContinuousEventPriority,
  getCurrentUpdatePriority,
  setCurrentUpdatePriority,
  higherEventPriority,
} from './ReactEventPriorities.new';
import {readContext, checkIfContextChanged} from './ReactFiberNewContext.new';
import {HostRoot, CacheComponent} from './ReactWorkTags';
import {
  LayoutStatic as LayoutStaticEffect,
  Passive as PassiveEffect,
  PassiveStatic as PassiveStaticEffect,
  StaticMask as StaticMaskEffect,
  Update as UpdateEffect,
  StoreConsistency,
  MountLayoutDev as MountLayoutDevEffect,
  MountPassiveDev as MountPassiveDevEffect,
} from './ReactFiberFlags';
import {
  HasEffect as HookHasEffect,
  Layout as HookLayout,
  Passive as HookPassive,
  Insertion as HookInsertion,
} from './ReactHookEffectTags';
import {
  getWorkInProgressRoot,
  getWorkInProgressRootRenderLanes,
  scheduleUpdateOnFiber,
  requestUpdateLane,
  requestEventTime,
  markSkippedUpdateLanes,
  isInvalidExecutionContextForEventFunction,
  getSuspendedThenableState,
} from './ReactFiberWorkLoop.new';

import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import is from 'shared/objectIs';
import isArray from 'shared/isArray';
import {
  markWorkInProgressReceivedUpdate,
  checkIfWorkInProgressReceivedUpdate,
} from './ReactFiberBeginWork.new';
import {getIsHydrating} from './ReactFiberHydrationContext.new';
import {
  getWorkInProgressVersion,
  markSourceAsDirty,
  setWorkInProgressVersion,
  warnAboutMultipleRenderersDEV,
} from './ReactMutableSource.new';
import {logStateUpdateScheduled} from './DebugTracing';
import {markStateUpdateScheduled} from './ReactFiberDevToolsHook.new';
import {createCache} from './ReactFiberCacheComponent.new';
import {
  createUpdate as createLegacyQueueUpdate,
  enqueueUpdate as enqueueLegacyQueueUpdate,
  entangleTransitions as entangleLegacyQueueTransitions,
} from './ReactFiberClassUpdateQueue.new';
import {
  enqueueConcurrentHookUpdate,
  enqueueConcurrentHookUpdateAndEagerlyBailout,
  enqueueConcurrentRenderForLane,
} from './ReactFiberConcurrentUpdates.new';
import {getTreeId} from './ReactFiberTreeContext.new';
import {now} from './Scheduler';
import {
  prepareThenableState,
  trackUsedThenable,
} from './ReactFiberThenable.new';

const {ReactCurrentDispatcher, ReactCurrentBatchConfig} = ReactSharedInternals;

export type Update<S, A> = {
  lane: Lane,
  action: A,
  hasEagerState: boolean,
  eagerState: S | null,
  next: Update<S, A>,
};

export type UpdateQueue<S, A> = {
  pending: Update<S, A> | null,
  lanes: Lanes,
  dispatch: (A => mixed) | null,
  lastRenderedReducer: ((S, A) => S) | null,
  lastRenderedState: S | null,
};

let didWarnAboutMismatchedHooksForComponent;
let didWarnUncachedGetSnapshot;
if (__DEV__) {
  didWarnAboutMismatchedHooksForComponent = new Set();
}

export type Hook = {
  memoizedState: any,
  baseState: any,
  baseQueue: Update<any, any> | null,
  queue: any,
  next: Hook | null,
};

export type Effect = {
  tag: HookFlags,
  create: () => (() => void) | void,
  destroy: (() => void) | void,
  deps: Array<mixed> | void | null,
  next: Effect,
};

type StoreInstance<T> = {
  value: T,
  getSnapshot: () => T,
};

type StoreConsistencyCheck<T> = {
  value: T,
  getSnapshot: () => T,
};

type EventFunctionPayload<Args, Return, F: (...Array<Args>) => Return> = {
  ref: {
    eventFn: F,
    impl: F,
  },
  nextImpl: F,
};

export type FunctionComponentUpdateQueue = {
  lastEffect: Effect | null,
  events: Array<EventFunctionPayload<any, any, any>> | null,
  stores: Array<StoreConsistencyCheck<any>> | null,
  // NOTE: optional, only set when enableUseMemoCacheHook is enabled
  memoCache?: MemoCache | null,
};

type BasicStateAction<S> = (S => S) | S;

type Dispatch<A> = A => void;

// These are set right before calling the component.
let renderLanes: Lanes = NoLanes;
// The work-in-progress fiber. I've named it differently to distinguish it from
// the work-in-progress hook.
let currentlyRenderingFiber: Fiber = (null: any);

// Hooks are stored as a linked list on the fiber's memoizedState field. The
// current hook list is the list that belongs to the current fiber. The
// work-in-progress hook list is a new list that will be added to the
// work-in-progress fiber.
let currentHook: Hook | null = null;
let workInProgressHook: Hook | null = null;

// Whether an update was scheduled at any point during the render phase. This
// does not get reset if we do another render pass; only when we're completely
// finished evaluating this component. This is an optimization so we know
// whether we need to clear render phase updates after a throw.
let didScheduleRenderPhaseUpdate: boolean = false;
// Where an update was scheduled only during the current render pass. This
// gets reset after each attempt.
// TODO: Maybe there's some way to consolidate this with
// `didScheduleRenderPhaseUpdate`. Or with `numberOfReRenders`.
let didScheduleRenderPhaseUpdateDuringThisPass: boolean = false;
// Counts the number of useId hooks in this component.
let localIdCounter: number = 0;
// Counts number of `use`-d thenables
let thenableIndexCounter: number = 0;

// Used for ids that are generated completely client-side (i.e. not during
// hydration). This counter is global, so client ids are not stable across
// render attempts.
let globalClientIdCounter: number = 0;

const RE_RENDER_LIMIT = 25;

// In DEV, this is the name of the currently executing primitive hook
let currentHookNameInDev: ?HookType = null;

// In DEV, this list ensures that hooks are called in the same order between renders.
// The list stores the order of hooks used during the initial render (mount).
// Subsequent renders (updates) reference this list.
let hookTypesDev: Array<HookType> | null = null;
let hookTypesUpdateIndexDev: number = -1;

// In DEV, this tracks whether currently rendering component needs to ignore
// the dependencies for Hooks that need them (e.g. useEffect or useMemo).
// When true, such Hooks will always be "remounted". Only used during hot reload.
let ignorePreviousDependencies: boolean = false;

function mountHookTypesDev() {
  if (__DEV__) {
    const hookName = ((currentHookNameInDev: any): HookType);

    if (hookTypesDev === null) {
      hookTypesDev = [hookName];
    } else {
      hookTypesDev.push(hookName);
    }
  }
}

function updateHookTypesDev() {
  if (__DEV__) {
    const hookName = ((currentHookNameInDev: any): HookType);

    if (hookTypesDev !== null) {
      hookTypesUpdateIndexDev++;
      if (hookTypesDev[hookTypesUpdateIndexDev] !== hookName) {
        warnOnHookMismatchInDev(hookName);
      }
    }
  }
}

function checkDepsAreArrayDev(deps: mixed) {
  if (__DEV__) {
    if (deps !== undefined && deps !== null && !isArray(deps)) {
      // Verify deps, but only on mount to avoid extra checks.
      // It's unlikely their type would change as usually you define them inline.
      console.error(
        '%s received a final argument that is not an array (instead, received `%s`). When ' +
          'specified, the final argument must be an array.',
        currentHookNameInDev,
        typeof deps,
      );
    }
  }
}

function warnOnHookMismatchInDev(currentHookName: HookType) {
  if (__DEV__) {
    const componentName = getComponentNameFromFiber(currentlyRenderingFiber);
    if (!didWarnAboutMismatchedHooksForComponent.has(componentName)) {
      didWarnAboutMismatchedHooksForComponent.add(componentName);

      if (hookTypesDev !== null) {
        let table = '';

        const secondColumnStart = 30;

        for (let i = 0; i <= ((hookTypesUpdateIndexDev: any): number); i++) {
          const oldHookName = hookTypesDev[i];
          const newHookName =
            i === ((hookTypesUpdateIndexDev: any): number)
              ? currentHookName
              : oldHookName;

          let row = `${i + 1}. ${oldHookName}`;

          // Extra space so second column lines up
          // lol @ IE not supporting String#repeat
          while (row.length < secondColumnStart) {
            row += ' ';
          }

          row += newHookName + '\n';

          table += row;
        }

        console.error(
          'React has detected a change in the order of Hooks called by %s. ' +
            'This will lead to bugs and errors if not fixed. ' +
            'For more information, read the Rules of Hooks: https://reactjs.org/link/rules-of-hooks\n\n' +
            '   Previous render            Next render\n' +
            '   ------------------------------------------------------\n' +
            '%s' +
            '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n',
          componentName,
          table,
        );
      }
    }
  }
}

function throwInvalidHookError() {
  throw new Error(
    'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
      ' one of the following reasons:\n' +
      '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
      '2. You might be breaking the Rules of Hooks\n' +
      '3. You might have more than one copy of React in the same app\n' +
      'See https://reactjs.org/link/invalid-hook-call for tips about how to debug and fix this problem.',
  );
}

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function areHookInputsEqual(
  nextDeps: Array<mixed>,
  prevDeps: Array<mixed> | null,
) {
  if (__DEV__) {
    if (ignorePreviousDependencies) {
      // Only true when this component is being hot reloaded.
      return false;
    }
  }

  if (prevDeps === null) {
    if (__DEV__) {
      console.error(
        '%s received a final argument during this render, but not during ' +
          'the previous render. Even though the final argument is optional, ' +
          'its type cannot change between renders.',
        currentHookNameInDev,
      );
    }
    return false;
  }

  if (__DEV__) {
    // Don't bother comparing lengths in prod because these arrays should be
    // passed inline.
    if (nextDeps.length !== prevDeps.length) {
      console.error(
        'The final argument passed to %s changed size between renders. The ' +
          'order and size of this array must remain constant.\n\n' +
          'Previous: %s\n' +
          'Incoming: %s',
        currentHookNameInDev,
        `[${prevDeps.join(', ')}]`,
        `[${nextDeps.join(', ')}]`,
      );
    }
  }
  // $FlowFixMe[incompatible-use] found when upgrading Flow

  // 循环遍历
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    // $FlowFixMe[incompatible-use] found when upgrading Flow


    if (is(nextDeps[i], prevDeps[i])) { // shared/objectIs - 实际上是Object.is算法 api
      continue;
    }
    return false;
  }
  return true;
}

// 带有hooks的渲染 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function renderWithHooks<Props, SecondArg>(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: (p: Props, arg: SecondArg) => any,
  props: Props,
  secondArg: SecondArg,
  nextRenderLanes: Lanes,
): any {

  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  renderLanes = nextRenderLanes;
  currentlyRenderingFiber = workInProgress; // currentlyRenderingFiber // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  if (__DEV__) {
    hookTypesDev =
      current !== null
        ? ((current._debugHookTypes: any): Array<HookType>)
        : null;
    hookTypesUpdateIndexDev = -1;
    // Used for hot reloading:
    ignorePreviousDependencies =
      current !== null && current.type !== workInProgress.type;
  }

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // 首先重置状态 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  workInProgress.memoizedState = null;
  workInProgress.updateQueue = null;
  workInProgress.lanes = NoLanes;
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // The following should have already been reset
  // currentHook = null;
  // workInProgressHook = null;

  // didScheduleRenderPhaseUpdate = false;
  // localIdCounter = 0;
  // thenableIndexCounter = 0;

  // TODO Warn if no hooks are used at all during mount, then some are used during update.
  // Currently we will identify the update render as a mount because memoizedState === null.
  // This is tricky because it's valid for certain types of components (e.g. React.lazy)

  // Using memoizedState to differentiate between mount/update only works if at least one stateful hook is used.
  // Non-stateful hooks (e.g. context) don't get added to memoizedState,
  // so memoizedState would be null during updates and mounts.
  if (__DEV__) {
    if (current !== null && current.memoizedState !== null) { // hook对象不为null
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // OnUpdate // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      ReactCurrentDispatcher.current = HooksDispatcherOnUpdateInDEV; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    } else if (hookTypesDev !== null) {
      // This dispatcher handles an edge case where a component is updating,
      // but no stateful hooks have been used.
      // We want to match the production code behavior (which will use HooksDispatcherOnMount),
      // but with the extra DEV validation to ensure hooks ordering hasn't changed.
      // This dispatcher does that.
      ReactCurrentDispatcher.current = HooksDispatcherOnMountWithHookTypesInDEV;
    } else {
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      ReactCurrentDispatcher.current = HooksDispatcherOnMountInDEV; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }
  } else {
    ReactCurrentDispatcher.current =
      current === null || current.memoizedState === null
        ? HooksDispatcherOnMount
        : HooksDispatcherOnUpdate;
  }

  // If this is a replay, restore the thenable state from the previous attempt.
  const prevThenableState = getSuspendedThenableState();
  prepareThenableState(prevThenableState);


  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  let children = Component(props, secondArg); // 直接调用组件函数 - 返回虚拟dom元素
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 检查是否是渲染阶段的更新 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // Check if there was a render phase update
  if (didScheduleRenderPhaseUpdateDuringThisPass) { // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // Keep rendering in a loop for as long as render phase updates continue to
    // be scheduled. Use a counter to prevent infinite loops.
    let numberOfReRenders: number = 0;
    do {
      didScheduleRenderPhaseUpdateDuringThisPass = false; // ++++++++++++++++++++++++++++++++++++++++++++++++++
      localIdCounter = 0;
      thenableIndexCounter = 0;

      if (numberOfReRenders >= RE_RENDER_LIMIT) {
        throw new Error(
          'Too many re-renders. React limits the number of renders to prevent ' +
            'an infinite loop.',
        );
      }

      numberOfReRenders += 1;
      if (__DEV__) {
        // Even when hot reloading, allow dependencies to stabilize
        // after first render to prevent infinite render phase updates.
        ignorePreviousDependencies = false;
      }

      // Start over from the beginning of the list
      currentHook = null;
      workInProgressHook = null;

      workInProgress.updateQueue = null;

      if (__DEV__) {
        // Also validate hook order for cascading updates.
        hookTypesUpdateIndexDev = -1;
      }

      ReactCurrentDispatcher.current = __DEV__
        ? HooksDispatcherOnRerenderInDEV // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        : HooksDispatcherOnRerender;

      prepareThenableState(prevThenableState);
      
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      children = Component(props, secondArg); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    } while (didScheduleRenderPhaseUpdateDuringThisPass); // +++++++++++++++++++++++++++++++++++++++++++++

  }

  // We can assume the previous dispatcher is always this one, since we set it
  // at the beginning of the render phase and there's no re-entrance.
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;

  if (__DEV__) {
    workInProgress._debugHookTypes = hookTypesDev;
  }

  // This check uses currentHook so that it works the same in DEV and prod bundles.
  // hookTypesDev could catch more cases (e.g. context) but only in DEV bundles.
  const didRenderTooFewHooks =
    currentHook !== null && currentHook.next !== null;

  // 重置 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++++++++++++++++++++++++++++++++++++++++++++++
  renderLanes = NoLanes;
  currentlyRenderingFiber = (null: any); // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  currentHook = null;
  workInProgressHook = null;
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  if (__DEV__) {
    currentHookNameInDev = null;
    hookTypesDev = null;
    hookTypesUpdateIndexDev = -1;

    // Confirm that a static flag was not added or removed since the last
    // render. If this fires, it suggests that we incorrectly reset the static
    // flags in some other part of the codebase. This has happened before, for
    // example, in the SuspenseList implementation.
    if (
      current !== null &&
      (current.flags & StaticMaskEffect) !==
        (workInProgress.flags & StaticMaskEffect) &&
      // Disable this warning in legacy mode, because legacy Suspense is weird
      // and creates false positives. To make this work in legacy mode, we'd
      // need to mark fibers that commit in an incomplete state, somehow. For
      // now I'll disable the warning that most of the bugs that would trigger
      // it are either exclusive to concurrent mode or exist in both.
      (current.mode & ConcurrentMode) !== NoMode
    ) {
      console.error(
        'Internal React error: Expected static flag was missing. Please ' +
          'notify the React team.',
      );
    }
  }

  // 重置 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
  didScheduleRenderPhaseUpdate = false;
  // This is reset by checkDidRenderIdHook
  // localIdCounter = 0;
  thenableIndexCounter = 0;

  if (didRenderTooFewHooks) {
    throw new Error(
      'Rendered fewer hooks than expected. This may be caused by an accidental ' +
        'early return statement.',
    );
  }

  if (enableLazyContextPropagation) {
    if (current !== null) {
      if (!checkIfWorkInProgressReceivedUpdate()) {
        // If there were no changes to props or state, we need to check if there
        // was a context change. We didn't already do this because there's no
        // 1:1 correspondence between dependencies and hooks. Although, because
        // there almost always is in the common case (`readContext` is an
        // internal API), we could compare in there. OTOH, we only hit this case
        // if everything else bails out, so on the whole it might be better to
        // keep the comparison out of the common path.
        const currentDependencies = current.dependencies;
        if (
          currentDependencies !== null &&
          checkIfContextChanged(currentDependencies)
        ) {
          markWorkInProgressReceivedUpdate();
        }
      }
    }
  }

  // 返回children // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return children;
}

export function checkDidRenderIdHook(): boolean {
  // This should be called immediately after every renderWithHooks call.
  // Conceptually, it's part of the return value of renderWithHooks; it's only a
  // separate function to avoid using an array tuple.
  const didRenderIdHook = localIdCounter !== 0;
  localIdCounter = 0;
  return didRenderIdHook;
}

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function bailoutHooks(
  current: Fiber,
  workInProgress: Fiber,
  lanes: Lanes,
) {
  workInProgress.updateQueue = current.updateQueue;
  // TODO: Don't need to reset the flags here, because they're reset in the
  // complete phase (bubbleProperties).
  if (__DEV__ && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    workInProgress.flags &= ~( // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      MountPassiveDevEffect |
      MountLayoutDevEffect |
      PassiveEffect |
      UpdateEffect
    );
  } else {
    workInProgress.flags &= ~(PassiveEffect | UpdateEffect); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }
  current.lanes = removeLanes(current.lanes, lanes); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

export function resetHooksAfterThrow(): void {
  // We can assume the previous dispatcher is always this one, since we set it
  // at the beginning of the render phase and there's no re-entrance.
  ReactCurrentDispatcher.current = ContextOnlyDispatcher;

  if (didScheduleRenderPhaseUpdate) {
    // There were render phase updates. These are only valid for this render
    // phase, which we are now aborting. Remove the updates from the queues so
    // they do not persist to the next render. Do not remove updates from hooks
    // that weren't processed.
    //
    // Only reset the updates from the queue if it has a clone. If it does
    // not have a clone, that means it wasn't processed, and the updates were
    // scheduled before we entered the render phase.
    let hook: Hook | null = currentlyRenderingFiber.memoizedState;
    while (hook !== null) {
      const queue = hook.queue;
      if (queue !== null) {
        queue.pending = null;
      }
      hook = hook.next;
    }
    didScheduleRenderPhaseUpdate = false;
  }

  renderLanes = NoLanes;
  currentlyRenderingFiber = (null: any);

  currentHook = null;
  workInProgressHook = null;

  if (__DEV__) {
    hookTypesDev = null;
    hookTypesUpdateIndexDev = -1;

    currentHookNameInDev = null;

    isUpdatingOpaqueValueInRenderPhase = false;
  }

  didScheduleRenderPhaseUpdateDuringThisPass = false;
  localIdCounter = 0;
  thenableIndexCounter = 0;
}

// 挂载wip hook
function mountWorkInProgressHook(): Hook {
  // 准备hook对象
  const hook: Hook = {
    memoizedState: null, // hook中的上一次状态

    baseState: null, // hook中的基础状态
    baseQueue: null, // hook中的基础queue
    queue: null, // hook中的queue

    next: null, // hook对象的next
  };

  if (workInProgressHook === null) {
    // 这是列表中的第一个hook
    // This is the first hook in the list
    currentlyRenderingFiber.memoizedState = workInProgressHook = hook; // 设置给当前正在渲染的fiber的上一次状态中 - 同时挂到workInProgressHook下
  } else {
    // 追加到列表的末尾
    // Append to the end of the list
    workInProgressHook = workInProgressHook.next = hook; // 添加到workInProgressHook的next属性上 - 同时改变workInProgressHook为当前的hook对象
  }
  // 返回workInProgressHook执行的hook对象
  return workInProgressHook;
}

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateWorkInProgressHook(): Hook {
  // This function is used both for updates and for re-renders triggered by a
  // render phase update. It assumes there is either a current hook we can
  // clone, or a work-in-progress hook from a previous render pass that we can
  // use as a base. When we reach the end of the base list, we must switch to
  // the dispatcher used for mounts.
  let nextCurrentHook: null | Hook; // 它是指向current hook的
  /* 
  currentHook和workInProgressHook在当前这里renderWithHooks函数中执行完Component函数之后就全部置为null了 // ++++++++++++++++++++++++++++++++++++++++
  同时它们默认也是为null的
  */
  if (currentHook === null) {
    const current = currentlyRenderingFiber.alternate; // 当前正在渲染中的fiber的alternate属性拿到对应的current
    if (current !== null) {
      nextCurrentHook = current.memoizedState; // 直接取它的hook对象 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    } else {
      nextCurrentHook = null;
    }
  } else {
    nextCurrentHook = currentHook.next;
  }

  let nextWorkInProgressHook: null | Hook; // 它是指向workInProgress hook的
  if (workInProgressHook === null) {
    // null
    nextWorkInProgressHook = currentlyRenderingFiber.memoizedState; // 在renderWithHooks函数中每次执行Component函数之前都会重置fiber的memoizedState为null // ++++++++++++++++++
  } else {
    nextWorkInProgressHook = workInProgressHook.next;
  }

  if (nextWorkInProgressHook !== null) {
    // There's already a work-in-progress. Reuse it.
    workInProgressHook = nextWorkInProgressHook;
    nextWorkInProgressHook = workInProgressHook.next;

    currentHook = nextCurrentHook;
  } else {

    // 则从current hook中克隆一个 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // Clone from the current hook.

    if (nextCurrentHook === null) {
      throw new Error('Rendered more hooks than during the previous render.');
    }

    // current hook指向nextCurrentHook
    currentHook = nextCurrentHook; // 也就是current hook链表中的第一个hook对象

    // 准备新的hook对象
    const newHook: Hook = {
      memoizedState: currentHook.memoizedState, // current hook的上一次状态

      baseState: currentHook.baseState, // ++++++++++++++++++++++++++++++
      baseQueue: currentHook.baseQueue,
      // 这里复用
      queue: currentHook.queue, // 它一直是dispatchSetState函数绑定的那一个同一个的queue对象，这里复用它++++++++++++++++++++++++++++++++++++++

      next: null, // next指针
    };

    if (workInProgressHook === null) {
      // 这是列表中的第一个钩子。
      // This is the first hook in the list.
      currentlyRenderingFiber.memoizedState = workInProgressHook = newHook; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    } else {
      // Append to the end of the list.
      workInProgressHook = workInProgressHook.next = newHook; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }
  }
  return workInProgressHook; // 返回workInProgressHook
}

// NOTE: defining two versions of this function to avoid size impact when this feature is disabled.
// Previously this function was inlined, the additional `memoCache` property makes it not inlined.
let createFunctionComponentUpdateQueue: () => FunctionComponentUpdateQueue; // 创建函数式组件updateQueue // +++++++++++++++++++++++++++++
if (enableUseMemoCacheHook) {
  createFunctionComponentUpdateQueue = () => {
    return {
      lastEffect: null,
      events: null,
      stores: null,
      memoCache: null,
    };
  };
} else {
  createFunctionComponentUpdateQueue = () => {
    return {
      lastEffect: null,
      events: null,
      stores: null,
    };
  };
}

function use<T>(usable: Usable<T>): T {
  if (usable !== null && typeof usable === 'object') {
    // $FlowFixMe[method-unbinding]
    if (typeof usable.then === 'function') {
      // This is a thenable.
      const thenable: Thenable<T> = (usable: any);

      // Track the position of the thenable within this fiber.
      const index = thenableIndexCounter;
      thenableIndexCounter += 1;
      return trackUsedThenable(thenable, index);
    } else if (
      usable.$$typeof === REACT_CONTEXT_TYPE ||
      usable.$$typeof === REACT_SERVER_CONTEXT_TYPE
    ) {
      const context: ReactContext<T> = (usable: any);
      return readContext(context);
    }
  }

  // eslint-disable-next-line react-internal/safe-string-coercion
  throw new Error('An unsupported type was passed to use(): ' + String(usable));
}

function useMemoCache(size: number): Array<any> {
  let memoCache = null;
  // Fast-path, load memo cache from wip fiber if already prepared
  let updateQueue: FunctionComponentUpdateQueue | null = (currentlyRenderingFiber.updateQueue: any);
  if (updateQueue !== null) {
    memoCache = updateQueue.memoCache;
  }
  // Otherwise clone from the current fiber
  if (memoCache == null) {
    const current: Fiber | null = currentlyRenderingFiber.alternate;
    if (current !== null) {
      const currentUpdateQueue: FunctionComponentUpdateQueue | null = (current.updateQueue: any);
      if (currentUpdateQueue !== null) {
        const currentMemoCache: ?MemoCache = currentUpdateQueue.memoCache;
        if (currentMemoCache != null) {
          memoCache = {
            data: currentMemoCache.data.map(array => array.slice()),
            index: 0,
          };
        }
      }
    }
  }
  // Finally fall back to allocating a fresh instance of the cache
  if (memoCache == null) {
    memoCache = {
      data: [],
      index: 0,
    };
  }
  if (updateQueue === null) {
    updateQueue = createFunctionComponentUpdateQueue();
    currentlyRenderingFiber.updateQueue = updateQueue;
  }
  updateQueue.memoCache = memoCache;

  let data = memoCache.data[memoCache.index];
  if (data === undefined) {
    data = memoCache.data[memoCache.index] = new Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = REACT_MEMO_CACHE_SENTINEL;
    }
  } else if (data.length !== size) {
    // TODO: consider warning or throwing here
    if (__DEV__) {
      console.error(
        'Expected a constant size argument for each invocation of useMemoCache. ' +
          'The previous cache was allocated with size %s but size %s was requested.',
        data.length,
        size,
      );
    }
  }
  memoCache.index++;
  return data;
}

// 基础状态reducer
function basicStateReducer<S>(state: S, action: BasicStateAction<S>): S {
  // $FlowFixMe: Flow doesn't like mixed types
  return typeof action === 'function' ? action(state) : action;
}

// 挂载reducer
function mountReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {

  const hook = mountWorkInProgressHook();
  // 形成hook链表
  
  // 准备初始化状态
  let initialState;
  

  if (init !== undefined) {
    // 执行init函数 - 把initialArg作为其参数传递
    initialState = init(initialArg); // 得到初始化状态
  } else {
    initialState = ((initialArg: any): S); // 直接把初始化参数作为初始化状态
  }
  
  // 然后把初始化状态存储到hook对象的【baseState】、【memoizedState】属性上
  hook.memoizedState = hook.baseState = initialState;
  
  // 还是和useState一样准备queue对象
  const queue: UpdateQueue<S, A> = {
    pending: null,
    lanes: NoLanes,
    dispatch: null,
    lastRenderedReducer: reducer, // 用户的reducer函数 // +++
    lastRenderedState: (initialState: any),
  };
  
  // 放在hook的queue上
  hook.queue = queue;
  
  // 产生dispatch函数
  const dispatch: Dispatch<A> = (queue.dispatch = (dispatchReducerAction.bind( // 注意是dispatchReducerAction函数 // +++
    null,
    currentlyRenderingFiber,
    queue,
  ): any));

  // 返回数组
  return [hook.memoizedState, dispatch];
}

/* 
https://reactjs.org/docs/hooks-reference.html#usereducer

const initialState = {count: 0}

function reducer(state, action) {
  switch (action.type) {
    case 'increment':
      return {count: state.count + 1}
    case 'decrement':
      return {count: state.count - 1}
    default:
      throw new Error()
  }
}

function Counter() {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <>
      Count: {state.count}
      <button onClick={() => dispatch({type: 'decrement'})}>-</button>
      <button onClick={() => dispatch({type: 'increment'})}>+</button>
    </>
  )
}
*/

// useState和useReducer在update期间使用的是相同的函数updateReducer // ++++++
// 更新reducer // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateReducer<S, I, A>(
  reducer: (S, A) => S,
  // +++
  // 下面这两个参数直接丢弃了 // 要注意 +++
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {

  // 执行updateWorkInProgressHook函数
  const hook = updateWorkInProgressHook(); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  const queue = hook.queue; // 取出hook对象上的queue - 其实它就是dispatchSetState函数绑定的那一个queue - 一直没有变过

  if (queue === null) {
    throw new Error(
      'Should have a queue. This is likely a bug in React. Please file an issue.',
    );
  }

  // 更新queue中的lastRenderedReducer为新的reducer函数 - 用户reducer
  queue.lastRenderedReducer = reducer; // 依然还是basicStateReducer函数

  const current: Hook = (currentHook: any); // current hook链表中的第一个hook对象

  // The last rebase update that is NOT part of the base state.
  let baseQueue = current.baseQueue; // null

  // The last pending update that hasn't been processed yet.
  const pendingQueue = queue.pending; // 取出没有变过的（dispatchSetState绑定的queue对象）queue对象中的pending queue，其实就是依靠update对象形成的环形链表 // ++++++++++++++++

  if (pendingQueue !== null) {
    // We have new updates that haven't been processed yet.
    // We'll add them to the base queue.
    if (baseQueue !== null) {
      // Merge the pending queue and the base queue.
      const baseFirst = baseQueue.next;
      const pendingFirst = pendingQueue.next;
      baseQueue.next = pendingFirst;
      pendingQueue.next = baseFirst;
      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // 环形链表 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // 环形链表的特征是最后一个的next指向第一个
      // 0 -> 1 -> 2 -> 0
      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }
    if (__DEV__) {
      if (current.baseQueue !== baseQueue) {
        // Internal invariant that should never happen, but feasibly could in
        // the future if we implement resuming, or some form of that.
        console.error(
          'Internal error: Expected work-in-progress queue to be a clone. ' +
            'This is a bug in React.',
        );
      }
    }

    // 始终指向环形链表的最后一个 - 目的是为了直接能够拿到第一个update // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    current.baseQueue = baseQueue = pendingQueue; // update对象形成的环形链表
    // 置空queue（dispatchSetState绑定的queue对象）中的pending属性 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    queue.pending = null;
  }

  if (baseQueue !== null) {
    // 我们有一个队列要去处理 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // We have a queue to process.
    const first = baseQueue.next; // 通过环形链表最后一个的next拿到环形链表的第一个update对象

    // current hook的baseState - 其实就是mountReducer中的initialState // +++
    let newState = current.baseState; // 获取current hook对象上的基础状态，作为新状态，它是要作为下面的基础的 // ++++++++++++++++++++++++++++++++++++++++++++++

    let newBaseState = null;
    let newBaseQueueFirst = null;
    let newBaseQueueLast = null;
    let update = first;
    // do while循环
    do {
      // An extra OffscreenLane bit is added to updates that were made to
      // a hidden tree, so that we can distinguish them from updates that were
      // already there when the tree was hidden.
      const updateLane = removeLanes(update.lane, OffscreenLane);
      const isHiddenUpdate = updateLane !== update.lane;

      // Check if this update was made while the tree was hidden. If so, then
      // it's not a "base" update and we should disregard the extra base lanes
      // that were added to renderLanes when we entered the Offscreen tree.
      const shouldSkipUpdate = isHiddenUpdate
        ? !isSubsetOfLanes(getWorkInProgressRootRenderLanes(), updateLane)
        : !isSubsetOfLanes(renderLanes, updateLane);

      if (shouldSkipUpdate) {
        // Priority is insufficient. Skip this update. If this is the first
        // skipped update, the previous update/state is the new base
        // update/state.
        const clone: Update<S, A> = {
          lane: updateLane,
          action: update.action,
          hasEagerState: update.hasEagerState,
          eagerState: update.eagerState,
          next: (null: any),
        };
        if (newBaseQueueLast === null) {
          newBaseQueueFirst = newBaseQueueLast = clone;
          newBaseState = newState;
        } else {
          newBaseQueueLast = newBaseQueueLast.next = clone;
        }
        // Update the remaining priority in the queue.
        // TODO: Don't need to accumulate this. Instead, we can remove
        // renderLanes from the original lanes.
        currentlyRenderingFiber.lanes = mergeLanes(
          currentlyRenderingFiber.lanes,
          updateLane,
        );
        markSkippedUpdateLanes(updateLane);
      } else { // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        // This update does have sufficient priority.

        if (newBaseQueueLast !== null) {
          const clone: Update<S, A> = {
            // This update is going to be committed so we never want uncommit
            // it. Using NoLane works because 0 is a subset of all bitmasks, so
            // this will never be skipped by the check above.
            lane: NoLane,
            action: update.action,
            hasEagerState: update.hasEagerState,
            eagerState: update.eagerState,
            next: (null: any),
          };
          newBaseQueueLast = newBaseQueueLast.next = clone;
        }

        // 更新newState
        // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        // Process this update.
        if (update.hasEagerState) { // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
          // If this update is a state update (not a reducer) and was processed eagerly,
          // we can use the eagerly computed state
          newState = ((update.eagerState: any): S);
        } else {
          // 【useReducer它是一直走的这里】 - 因为他在dispatchReducerAction函数中并没有计算而是直接入队列了然后进行调度的，所以对于他来讲它的hasEagerState为false
          const action = update.action;
          // 用户reducer函数
          newState = reducer(newState, action); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
          // 对于useState来讲是basicStateReducer // +++
          // 而对于useReducer来讲是用户写的reducer // +++
        }
        // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      }
      update = update.next; // 下一个update
      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    } while (update !== null && update !== first);
    // do while循环一直通过环形链表中的update一直更新newState

    if (newBaseQueueLast === null) { // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      newBaseState = newState; // 新的基础状态
      // 更新替换 // +++
    } else {
      newBaseQueueLast.next = (newBaseQueueFirst: any);
    }

    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // 只在新状态与当前状态不同的情况下，标记fiber执行了工作。 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // Mark that the fiber performed work, but only if the new state is
    // different from the current state.
    if (!is(newState, hook.memoizedState)) { // Object.is算法是否一致 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // 不一样则标记全局变量didReceiveUpdate为true // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      markWorkInProgressReceivedUpdate(); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }

    // 更新workInProgress上的hook对象身上的属性
    hook.memoizedState = newState; // 1 // 更新替换 // +++
    hook.baseState = newBaseState; // 1 // 更新替换 // +++

    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    hook.baseQueue = newBaseQueueLast; // null // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    // 更新queue上的上一次渲染的状态
    queue.lastRenderedState = newState; // 1
  }

  if (baseQueue === null) {
    // `queue.lanes` is used for entangling transitions. We can set it back to
    // zero once the queue is empty.
    queue.lanes = NoLanes;
  }

  // 依然是queue上的dispatch函数 - 没有变化过 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  const dispatch: Dispatch<A> = (queue.dispatch: any);

  return [hook.memoizedState, dispatch];
}

function rerenderReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  const hook = updateWorkInProgressHook();
  const queue = hook.queue;

  if (queue === null) {
    throw new Error(
      'Should have a queue. This is likely a bug in React. Please file an issue.',
    );
  }

  queue.lastRenderedReducer = reducer;

  // This is a re-render. Apply the new render phase updates to the previous
  // work-in-progress hook.
  const dispatch: Dispatch<A> = (queue.dispatch: any);
  const lastRenderPhaseUpdate = queue.pending;
  let newState = hook.memoizedState;
  if (lastRenderPhaseUpdate !== null) {
    // The queue doesn't persist past this render pass.
    queue.pending = null;

    const firstRenderPhaseUpdate = lastRenderPhaseUpdate.next;
    let update = firstRenderPhaseUpdate;
    do {
      // Process this render phase update. We don't have to check the
      // priority because it will always be the same as the current
      // render's.
      const action = update.action;
      newState = reducer(newState, action);
      update = update.next;
    } while (update !== firstRenderPhaseUpdate);

    // Mark that the fiber performed work, but only if the new state is
    // different from the current state.
    if (!is(newState, hook.memoizedState)) {
      markWorkInProgressReceivedUpdate();
    }

    hook.memoizedState = newState;
    // Don't persist the state accumulated from the render phase updates to
    // the base state unless the queue is empty.
    // TODO: Not sure if this is the desired semantics, but it's what we
    // do for gDSFP. I can't remember why.
    if (hook.baseQueue === null) {
      hook.baseState = newState;
    }

    queue.lastRenderedState = newState;
  }
  return [newState, dispatch];
}

type MutableSourceMemoizedState<Source, Snapshot> = {
  refs: {
    getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
    setSnapshot: Snapshot => void,
  },
  source: MutableSource<any>,
  subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
};

function readFromUnsubscribedMutableSource<Source, Snapshot>(
  root: FiberRoot,
  source: MutableSource<Source>,
  getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
): Snapshot {
  if (__DEV__) {
    warnAboutMultipleRenderersDEV(source);
  }

  const getVersion = source._getVersion;
  const version = getVersion(source._source);

  // Is it safe for this component to read from this source during the current render?
  let isSafeToReadFromSource = false;

  // Check the version first.
  // If this render has already been started with a specific version,
  // we can use it alone to determine if we can safely read from the source.
  const currentRenderVersion = getWorkInProgressVersion(source);
  if (currentRenderVersion !== null) {
    // It's safe to read if the store hasn't been mutated since the last time
    // we read something.
    isSafeToReadFromSource = currentRenderVersion === version;
  } else {
    // If there's no version, then this is the first time we've read from the
    // source during the current render pass, so we need to do a bit more work.
    // What we need to determine is if there are any hooks that already
    // subscribed to the source, and if so, whether there are any pending
    // mutations that haven't been synchronized yet.
    //
    // If there are no pending mutations, then `root.mutableReadLanes` will be
    // empty, and we know we can safely read.
    //
    // If there *are* pending mutations, we may still be able to safely read
    // if the currently rendering lanes are inclusive of the pending mutation
    // lanes, since that guarantees that the value we're about to read from
    // the source is consistent with the values that we read during the most
    // recent mutation.
    isSafeToReadFromSource = isSubsetOfLanes(
      renderLanes,
      root.mutableReadLanes,
    );

    if (isSafeToReadFromSource) {
      // If it's safe to read from this source during the current render,
      // store the version in case other components read from it.
      // A changed version number will let those components know to throw and restart the render.
      setWorkInProgressVersion(source, version);
    }
  }

  if (isSafeToReadFromSource) {
    const snapshot = getSnapshot(source._source);
    if (__DEV__) {
      if (typeof snapshot === 'function') {
        console.error(
          'Mutable source should not return a function as the snapshot value. ' +
            'Functions may close over mutable values and cause tearing.',
        );
      }
    }
    return snapshot;
  } else {
    // This handles the special case of a mutable source being shared between renderers.
    // In that case, if the source is mutated between the first and second renderer,
    // The second renderer don't know that it needs to reset the WIP version during unwind,
    // (because the hook only marks sources as dirty if it's written to their WIP version).
    // That would cause this tear check to throw again and eventually be visible to the user.
    // We can avoid this infinite loop by explicitly marking the source as dirty.
    //
    // This can lead to tearing in the first renderer when it resumes,
    // but there's nothing we can do about that (short of throwing here and refusing to continue the render).
    markSourceAsDirty(source);

    // Intentioally throw an error to force React to retry synchronously. During
    // the synchronous retry, it will block interleaved mutations, so we should
    // get a consistent read. Therefore, the following error should never be
    // visible to the user.

    // We expect this error not to be thrown during the synchronous retry,
    // because we blocked interleaved mutations.
    throw new Error(
      'Cannot read from mutable source during the current render without tearing. This may be a bug in React. Please file an issue.',
    );
  }
}

function useMutableSource<Source, Snapshot>(
  hook: Hook,
  source: MutableSource<Source>,
  getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
  subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
): Snapshot {
  if (!enableUseMutableSource) {
    return (undefined: any);
  }

  const root = ((getWorkInProgressRoot(): any): FiberRoot);

  if (root === null) {
    throw new Error(
      'Expected a work-in-progress root. This is a bug in React. Please file an issue.',
    );
  }

  const getVersion = source._getVersion;
  const version = getVersion(source._source);

  const dispatcher = ReactCurrentDispatcher.current;

  // eslint-disable-next-line prefer-const
  let [currentSnapshot, setSnapshot] = dispatcher.useState(() =>
    readFromUnsubscribedMutableSource(root, source, getSnapshot),
  );
  let snapshot = currentSnapshot;

  // Grab a handle to the state hook as well.
  // We use it to clear the pending update queue if we have a new source.
  const stateHook = ((workInProgressHook: any): Hook);

  const memoizedState = ((hook.memoizedState: any): MutableSourceMemoizedState<
    Source,
    Snapshot,
  >);
  const refs = memoizedState.refs;
  const prevGetSnapshot = refs.getSnapshot;
  const prevSource = memoizedState.source;
  const prevSubscribe = memoizedState.subscribe;

  const fiber = currentlyRenderingFiber;

  hook.memoizedState = ({
    refs,
    source,
    subscribe,
  }: MutableSourceMemoizedState<Source, Snapshot>);

  // Sync the values needed by our subscription handler after each commit.
  dispatcher.useEffect(() => {
    refs.getSnapshot = getSnapshot;

    // Normally the dispatch function for a state hook never changes,
    // but this hook recreates the queue in certain cases  to avoid updates from stale sources.
    // handleChange() below needs to reference the dispatch function without re-subscribing,
    // so we use a ref to ensure that it always has the latest version.
    refs.setSnapshot = setSnapshot;

    // Check for a possible change between when we last rendered now.
    const maybeNewVersion = getVersion(source._source);
    if (!is(version, maybeNewVersion)) {
      const maybeNewSnapshot = getSnapshot(source._source);
      if (__DEV__) {
        if (typeof maybeNewSnapshot === 'function') {
          console.error(
            'Mutable source should not return a function as the snapshot value. ' +
              'Functions may close over mutable values and cause tearing.',
          );
        }
      }

      if (!is(snapshot, maybeNewSnapshot)) {
        setSnapshot(maybeNewSnapshot);

        const lane = requestUpdateLane(fiber);
        markRootMutableRead(root, lane);
      }
      // If the source mutated between render and now,
      // there may be state updates already scheduled from the old source.
      // Entangle the updates so that they render in the same batch.
      markRootEntangled(root, root.mutableReadLanes);
    }
  }, [getSnapshot, source, subscribe]);

  // If we got a new source or subscribe function, re-subscribe in a passive effect.
  dispatcher.useEffect(() => {
    const handleChange = () => {
      const latestGetSnapshot = refs.getSnapshot;
      const latestSetSnapshot = refs.setSnapshot;

      try {
        latestSetSnapshot(latestGetSnapshot(source._source));

        // Record a pending mutable source update with the same expiration time.
        const lane = requestUpdateLane(fiber);

        markRootMutableRead(root, lane);
      } catch (error) {
        // A selector might throw after a source mutation.
        // e.g. it might try to read from a part of the store that no longer exists.
        // In this case we should still schedule an update with React.
        // Worst case the selector will throw again and then an error boundary will handle it.
        latestSetSnapshot(
          (() => {
            throw error;
          }: any),
        );
      }
    };

    const unsubscribe = subscribe(source._source, handleChange);
    if (__DEV__) {
      if (typeof unsubscribe !== 'function') {
        console.error(
          'Mutable source subscribe function must return an unsubscribe function.',
        );
      }
    }

    return unsubscribe;
  }, [source, subscribe]);

  // If any of the inputs to useMutableSource change, reading is potentially unsafe.
  //
  // If either the source or the subscription have changed we can't can't trust the update queue.
  // Maybe the source changed in a way that the old subscription ignored but the new one depends on.
  //
  // If the getSnapshot function changed, we also shouldn't rely on the update queue.
  // It's possible that the underlying source was mutated between the when the last "change" event fired,
  // and when the current render (with the new getSnapshot function) is processed.
  //
  // In both cases, we need to throw away pending updates (since they are no longer relevant)
  // and treat reading from the source as we do in the mount case.
  if (
    !is(prevGetSnapshot, getSnapshot) ||
    !is(prevSource, source) ||
    !is(prevSubscribe, subscribe)
  ) {
    // Create a new queue and setState method,
    // So if there are interleaved updates, they get pushed to the older queue.
    // When this becomes current, the previous queue and dispatch method will be discarded,
    // including any interleaving updates that occur.
    const newQueue: UpdateQueue<Snapshot, BasicStateAction<Snapshot>> = {
      pending: null,
      lanes: NoLanes,
      dispatch: null,
      lastRenderedReducer: basicStateReducer,
      lastRenderedState: snapshot,
    };
    newQueue.dispatch = setSnapshot = (dispatchSetState.bind(
      null,
      currentlyRenderingFiber,
      newQueue,
    ): any);
    stateHook.queue = newQueue;
    stateHook.baseQueue = null;
    snapshot = readFromUnsubscribedMutableSource(root, source, getSnapshot);
    stateHook.memoizedState = stateHook.baseState = snapshot;
  }

  return snapshot;
}

function mountMutableSource<Source, Snapshot>(
  source: MutableSource<Source>,
  getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
  subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
): Snapshot {
  if (!enableUseMutableSource) {
    return (undefined: any);
  }

  const hook = mountWorkInProgressHook();
  hook.memoizedState = ({
    refs: {
      getSnapshot,
      setSnapshot: (null: any),
    },
    source,
    subscribe,
  }: MutableSourceMemoizedState<Source, Snapshot>);
  return useMutableSource(hook, source, getSnapshot, subscribe);
}

function updateMutableSource<Source, Snapshot>(
  source: MutableSource<Source>,
  getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
  subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
): Snapshot {
  if (!enableUseMutableSource) {
    return (undefined: any);
  }

  const hook = updateWorkInProgressHook();
  return useMutableSource(hook, source, getSnapshot, subscribe);
}

// 挂载同步外部存储
function mountSyncExternalStore<T>(
  subscribe: (() => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  const fiber = currentlyRenderingFiber; // 拿到当前的workInProgress fiber
  // 它是在renderWithHooks函数中执行Component函数之前赋值的
  // 所以它就是函数式组件对应的workInProgress fiber

  const hook = mountWorkInProgressHook();
  // 形成hook链表

  let nextSnapshot;
  const isHydrating = getIsHydrating();
  if (isHydrating) {
    if (getServerSnapshot === undefined) {
      throw new Error(
        'Missing getServerSnapshot, which is required for ' +
          'server-rendered content. Will revert to client rendering.',
      );
    }
    nextSnapshot = getServerSnapshot();
    if (__DEV__) {
      if (!didWarnUncachedGetSnapshot) {
        if (nextSnapshot !== getServerSnapshot()) {
          console.error(
            'The result of getServerSnapshot should be cached to avoid an infinite loop',
          );
          didWarnUncachedGetSnapshot = true;
        }
      }
    }
  } else {

    // 不是混合
    nextSnapshot = getSnapshot(); // 直接执行getSnapshot函数获取快照

    if (__DEV__) {
      if (!didWarnUncachedGetSnapshot) {
        const cachedSnapshot = getSnapshot();
        if (!is(nextSnapshot, cachedSnapshot)) {
          console.error(
            'The result of getSnapshot should be cached to avoid an infinite loop',
          );
          didWarnUncachedGetSnapshot = true;
        }
      }
    }
    // Unless we're rendering a blocking lane, schedule a consistency check.
    // Right before committing, we will walk the tree and check if any of the
    // stores were mutated.
    //
    // We won't do this if we're hydrating server-rendered content, because if
    // the content is stale, it's already visible anyway. Instead we'll patch
    // it up in a passive effect.
    const root: FiberRoot | null = getWorkInProgressRoot();

    if (root === null) {
      throw new Error(
        'Expected a work-in-progress root. This is a bug in React. Please file an issue.',
      );
    }

    if (!includesBlockingLane(root, renderLanes)) {
      pushStoreConsistencyCheck(fiber, getSnapshot, nextSnapshot);
    }
  }

  // Read the current snapshot from the store on every render. This breaks the
  // normal rules of React, and only works because store updates are
  // always synchronous.
  hook.memoizedState = nextSnapshot; // 还是把新的快照存储在hook对象的memoizedState属性上 // +++

  // 准备存储实例
  const inst: StoreInstance<T> = {
    value: nextSnapshot, // value为新的快照值
    getSnapshot, // 获取快照函数
  };

  hook.queue = inst; // 直接把存储实例放在hook对象的queue属性上

  // 调度一个effect来去订阅store
  // Schedule an effect to subscribe to the store.
  mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [subscribe]); // 订阅存储函数
  // 相当于useEffect api的使用：依赖数组为subscribe订阅函数
  // create函数为subscribeToStore绑定返回的函数 - 它绑定的值为fiber, inst, subscribe


  // 直接作用就是会再次构建hook对象形成hook链表
  // 准备一个新的effect对象放在hook对象的memoizedState属性上
  // 然后给workInProgress fiber创建函数式组件updateQueue
  // 让新的effect对象形成一个环形链表，然后把这个新的effect对象放在updateQueue的lastEffect属性上
  // 这样每次就能够通过lastEffect的next属性获取环形链表的第一个effect对象了
  // 只会使用第一个effect对象直接通过next来去遍历整个环形链表 即可 ~


  // Schedule an effect to update the mutable instance fields. We will update
  // this whenever subscribe, getSnapshot, or value changes. Because there's no
  // clean-up function, and we track the deps correctly, we can call pushEffect
  // directly, without storing any additional state. For the same reason, we
  // don't need to set a static flag, either.
  // TODO: We can move this to the passive phase once we add a pre-commit
  // consistency check. See the next comment.
  fiber.flags |= PassiveEffect; // 给fiber的flags标记PassiveEffect
  // 这个标记在上面的mountEffect函数中已经标记过了

  // 这里再次创建一个effect对象以便于和之前的updateQueue形成环形链表，然后更新updateQueue上的lastEffect属性为当前新的effect对象
  pushEffect(
    HookHasEffect | HookPassive,
    // create
    updateStoreInstance.bind(null, fiber, inst, nextSnapshot, getSnapshot), // 更新仓库实例函数 - 绑定参数fiber, inst, nextSnapshot, getSnapshot
    // destroy
    undefined,
    // deps
    null,
  );

  return nextSnapshot;
}

// 更新同步外部存储
function updateSyncExternalStore<T>(
  subscribe: (() => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  const fiber = currentlyRenderingFiber; // wip fiber

  const hook = updateWorkInProgressHook();
  // 浅克隆
  // 这里主要是hook.memoizedState因为它是current hook的memoizedState也就是上一次执行getSnapshot函数返回的值
  // 还有它的queue属性，因为它是current hook上的queue属性也就是上一次准备的【存储实例的值】

  // Read the current snapshot from the store on every render. This breaks the
  // normal rules of React, and only works because store updates are
  // always synchronous.

  const nextSnapshot = getSnapshot(); // 再次执行getSnapshot函数得到新的快照值
  
  if (__DEV__) {
    if (!didWarnUncachedGetSnapshot) {
      const cachedSnapshot = getSnapshot();
      if (!is(nextSnapshot, cachedSnapshot)) {
        console.error(
          'The result of getSnapshot should be cached to avoid an infinite loop',
        );
        didWarnUncachedGetSnapshot = true;
      }
    }
  }

  const prevSnapshot = hook.memoizedState; // 之前的快照值

  const snapshotChanged = !is(prevSnapshot, nextSnapshot); // Object.is算法是否一致

  if (snapshotChanged) { // 变化了

    hook.memoizedState = nextSnapshot; // 替换新的快照值

    // ./ReactFiberBeginWork.new.js
    /* 
    export function markWorkInProgressReceivedUpdate() {
      didReceiveUpdate = true;
    }
    */
    markWorkInProgressReceivedUpdate(); // 标记didReceiveUpdate这个全局变量为true
  }


  const inst = hook.queue; // 取出存储实例

  // 还是相当于使用useEffect：依赖数组为订阅函数
  updateEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [ // 订阅存储函数 - 绑定的值为fiber, inst, subscribe
    subscribe,
  ]);
  // subscribe函数若变化了那么这个hook对象的memoizedState存储的effect对象的tag就多了个HookHasEffect这个标记
  // 注意不管是否变化那么都会向wip fiber的updateQueue中形成一个effect链表的
  // 只是没有变化的话这个effect对象的tag就少了HookHasEffect标记
  // 而这个标记将直接导致在commitRootImpl中的flushPassiveEffects中是否执行这个effect的destroy函数和create函数的 // +++
  


  // Whenever getSnapshot or subscribe changes, we need to check in the
  // commit phase if there was an interleaved mutation. In concurrent mode
  // this can happen all the time, but even in synchronous mode, an earlier
  // effect may have mutated the store.
  if (
    inst.getSnapshot !== getSnapshot || // 实例里面存储的获取快照函数不一样
    snapshotChanged || // 或者快照前后值变化了
    // 检查订阅函数是否改变。我们可以通过检查是否调度了上面的订阅effect来节省一些内存。

    // Check if the susbcribe function changed. We can save some memory by
    // checking whether we scheduled a subscription effect above.
    (workInProgressHook !== null &&
      workInProgressHook.memoizedState.tag & HookHasEffect) // 或者上面的使用的useEffect对应的hook的effect对象的tag有HookHasEffect标记，说明subscribe函数变化了
  ) {
    // 那么标记
    // 然后再向updateQueue中再形成一个effect对象
    fiber.flags |= PassiveEffect; // 标记wip fiber的flags为PassiveEffect

    // 还是创建一个effect对象以便于和之前的updateQueue形成环形链表，然后更新updateQueue上的lastEffect属性为当前新的effect对象
    pushEffect(
      HookHasEffect | HookPassive,
      updateStoreInstance.bind(null, fiber, inst, nextSnapshot, getSnapshot), // 更新仓库实例函数 - 绑定的值依旧是fiber, inst, nextSnapshot, getSnapshot
      undefined,
      null,
    );

    // Unless we're rendering a blocking lane, schedule a consistency check.
    // Right before committing, we will walk the tree and check if any of the
    // stores were mutated.
    const root: FiberRoot | null = getWorkInProgressRoot();

    if (root === null) {
      throw new Error(
        'Expected a work-in-progress root. This is a bug in React. Please file an issue.',
      );
    }

    if (!includesBlockingLane(root, renderLanes)) {
      pushStoreConsistencyCheck(fiber, getSnapshot, nextSnapshot);
    }
  }

  // 返回新的快照值 // +++
  return nextSnapshot;
}

function pushStoreConsistencyCheck<T>(
  fiber: Fiber,
  getSnapshot: () => T,
  renderedSnapshot: T,
) {
  fiber.flags |= StoreConsistency;
  const check: StoreConsistencyCheck<T> = {
    getSnapshot,
    value: renderedSnapshot,
  };
  let componentUpdateQueue: null | FunctionComponentUpdateQueue = (currentlyRenderingFiber.updateQueue: any);
  if (componentUpdateQueue === null) {
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    currentlyRenderingFiber.updateQueue = (componentUpdateQueue: any);
    componentUpdateQueue.stores = [check];
  } else {
    const stores = componentUpdateQueue.stores;
    if (stores === null) {
      componentUpdateQueue.stores = [check];
    } else {
      stores.push(check);
    }
  }
}

// 更新存储实例函数
function updateStoreInstance<T>(
  fiber: Fiber,
  inst: StoreInstance<T>,
  nextSnapshot: T,
  getSnapshot: () => T,
) {
  // These are updated in the passive phase
  inst.value = nextSnapshot;
  inst.getSnapshot = getSnapshot;
  // 直接更新

  // Something may have been mutated in between render and commit. This could
  // have been in an event that fired before the passive effects, or it could
  // have been in a layout effect. In that case, we would have used the old
  // snapsho and getSnapshot values to bail out. We need to check one more time.
  if (checkIfSnapshotChanged(inst)) { // 检查这个仓库实例的快照是否变化了
    // Force a re-render.
    forceStoreRerender(fiber); // 做一个强制的重新渲染 // +++
  }
}

// +++
// 这两个函数的执行都是在commit阶段中scheduleCallback执行使用postMessage产生的【宏任务】 - 执行flushPassiveEffects函数中执行的
// 异步执行的且是在更新完dom之后
// +++

// 订阅存储函数
function subscribeToStore<T>(fiber, inst: StoreInstance<T>, subscribe) {

  // 处理仓库变化的函数
  const handleStoreChange = () => {
    // The store changed. Check if the snapshot changed since the last time we
    // read from the store.
    if (checkIfSnapshotChanged(inst)) { // 检查这个仓库实例的快照是否变化了
      // Force a re-render.
      forceStoreRerender(fiber); // 做一个强制的重新渲染 // +++
    }
  };

  // 订阅仓库并返回清理功能。
  // Subscribe to the store and return a clean-up function.
  return subscribe(handleStoreChange); // 执行useSyncExternalStore函数传入的订阅函数 - 并给它传入一个函数
}

// 检查快照是否变化了
function checkIfSnapshotChanged<T>(inst: StoreInstance<T>): boolean {
  const latestGetSnapshot = inst.getSnapshot;
  const prevValue = inst.value; // 之前的值
  try {
    const nextValue = latestGetSnapshot(); // 再次执行获取快照函数得到新的值
    return !is(prevValue, nextValue); // 是否变化了
  } catch (error) {
    return true;
  }
}

// 强制store重新渲染
function forceStoreRerender(fiber) {
  // 为车道入队列并发渲染
  // 注意：同步车道 // +++
  const root = enqueueConcurrentRenderForLane(fiber, SyncLane); // 返回FiberRootNode

  if (root !== null) {
    // 注意：同步车道 // +++
    scheduleUpdateOnFiber(root, fiber, SyncLane, NoTimestamp); // 还是在fiber上调度更新
  }
}

// 挂载状态 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function mountState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  /* 
  // 准备hook对象
  const hook: Hook = {
    memoizedState: null, // hook中的上一次状态

    baseState: null, // hook中的基础状态
    baseQueue: null, // hook中的基础queue
    queue: null, // hook中的queue

    next: null, // hook对象的next
  };
  */
  const hook = mountWorkInProgressHook(); // 挂载wip hook // ++++++++++++++++++++++++++++++++++++++++++++++++
  if (typeof initialState === 'function') {
    // $FlowFixMe: Flow doesn't like mixed types
    initialState = initialState(); // 是函数直接执行函数得到初始化状态 // +++++++++++++++++++++++++++++++++++++
  }
  // hook的上一次状态 - 基础状态都设置为初始化状态
  hook.memoizedState = hook.baseState = initialState; // ++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 准备queue对象
  const queue: UpdateQueue<S, BasicStateAction<S>> = {
    pending: null,
    lanes: NoLanes, // 0
    dispatch: null,
    lastRenderedReducer: basicStateReducer, // 上一次渲染reducer为基础状态reducer
    lastRenderedState: (initialState: any), // 上一次渲染状态为初始化状态
  };
  hook.queue = queue; // 放到hook的queue上

  // 准备dispatch函数
  const dispatch: Dispatch<
    BasicStateAction<S>,
  > = (queue.dispatch = (dispatchSetState.bind( // 实际是dispatchSetState函数
    null,
    currentlyRenderingFiber, // 绑定当前正在渲染中的fiber
    queue, // 绑定当前创建的queue对象
    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  ): any)); // 一直绑定的fiber都是初次挂载右树创建的这个fiber，queue也是那时在这里创建的queue对象。+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // dispatchSetState函数绑定的fiber一直都是右边这棵树中的fiber节点
  // 而queue也是在此期间如上面创建好后的queue对象
  // 一直没有变化过
  /* 
  FiberRootNode
   |
   |current
   |
  \ /
  FiberNode  <--alternate-->  FiberNode（workInProgress）
  */
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


  return [hook.memoizedState, dispatch]; // 返回数组
}

// 更新状态函数 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  return updateReducer(basicStateReducer, (initialState: any)); // 基础状态reducer - 初始化状态
}

function rerenderState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  return rerenderReducer(basicStateReducer, (initialState: any));
}

// 推入effect // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function pushEffect(tag, create, destroy, deps: Array<mixed> | void | null) {

  // 准给effect对象
  const effect: Effect = {
    tag, // HookHasEffect | HookPassive
    create, // cb
    destroy,
    deps, // 依赖
    // Circular
    next: (null: any),
  };
  

  // 在renderWithHooks函数中会给wip的updateQueue置为null的 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  let componentUpdateQueue: null | FunctionComponentUpdateQueue = (currentlyRenderingFiber.updateQueue: any); // wip的updateQueue


  if (componentUpdateQueue === null) {

    // 创建函数式组件updateQueue
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    /* 
    返回这个对象
    {
      lastEffect: null,
      events: null,
      stores: null,
      memoCache: null,
    }
    */

    currentlyRenderingFiber.updateQueue = (componentUpdateQueue: any); // 放在wip的updateQueue属性上
    componentUpdateQueue.lastEffect = effect.next = effect; // 让updateQueue始终指向环形链表的最后一个effect
    // 构建环形链表 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


  } else {

    const lastEffect = componentUpdateQueue.lastEffect;
    if (lastEffect === null) {
      componentUpdateQueue.lastEffect = effect.next = effect; // 也是如同上面那样的


    } else {

      // 构建环形链表，updateQueue的lastEffect始终指向最后一个effect对象
      const firstEffect = lastEffect.next;
      lastEffect.next = effect;
      effect.next = firstEffect;
      componentUpdateQueue.lastEffect = effect;
    }

  }

  // 返回这个effect对象
  return effect;
}

let stackContainsErrorMessage: boolean | null = null;

function getCallerStackFrame(): string {
  // eslint-disable-next-line react-internal/prod-error-codes
  const stackFrames = new Error('Error message').stack.split('\n');

  // Some browsers (e.g. Chrome) include the error message in the stack
  // but others (e.g. Firefox) do not.
  if (stackContainsErrorMessage === null) {
    stackContainsErrorMessage = stackFrames[0].includes('Error message');
  }

  return stackContainsErrorMessage
    ? stackFrames.slice(3, 4).join('\n')
    : stackFrames.slice(2, 3).join('\n');
}

// 挂载ref
function mountRef<T>(initialValue: T): {current: T} {
  const hook = mountWorkInProgressHook();
  // 形成hook链表

  if (enableUseRefAccessWarning) {
    if (__DEV__) {
      // Support lazy initialization pattern shown in docs.
      // We need to store the caller stack frame so that we don't warn on subsequent renders.
      let hasBeenInitialized = initialValue != null;
      let lazyInitGetterStack = null;
      let didCheckForLazyInit = false;

      // Only warn once per component+hook.
      let didWarnAboutRead = false;
      let didWarnAboutWrite = false;

      let current = initialValue;
      const ref = {
        get current() {
          if (!hasBeenInitialized) {
            didCheckForLazyInit = true;
            lazyInitGetterStack = getCallerStackFrame();
          } else if (currentlyRenderingFiber !== null && !didWarnAboutRead) {
            if (
              lazyInitGetterStack === null ||
              lazyInitGetterStack !== getCallerStackFrame()
            ) {
              didWarnAboutRead = true;
              console.warn(
                '%s: Unsafe read of a mutable value during render.\n\n' +
                  'Reading from a ref during render is only safe if:\n' +
                  '1. The ref value has not been updated, or\n' +
                  '2. The ref holds a lazily-initialized value that is only set once.\n',
                getComponentNameFromFiber(currentlyRenderingFiber) || 'Unknown',
              );
            }
          }
          return current;
        },
        set current(value) {
          if (currentlyRenderingFiber !== null && !didWarnAboutWrite) {
            if (hasBeenInitialized || !didCheckForLazyInit) {
              didWarnAboutWrite = true;
              console.warn(
                '%s: Unsafe write of a mutable value during render.\n\n' +
                  'Writing to a ref during render is only safe if the ref holds ' +
                  'a lazily-initialized value that is only set once.\n',
                getComponentNameFromFiber(currentlyRenderingFiber) || 'Unknown',
              );
            }
          }

          hasBeenInitialized = true;
          current = value;
        },
      };
      Object.seal(ref);
      hook.memoizedState = ref;
      return ref;
    } else {
      const ref = {current: initialValue};
      hook.memoizedState = ref;
      return ref;
    }
  } else {


    const ref = {current: initialValue}; // 直接就是准备这个对象 - 对象中包含current属性，其值为value // +++++++++++++++++++++++++++++++++++++++++++++++++++++++

    // 还是将其放在hook对象的memoizedState属性上
    hook.memoizedState = ref;
    
    // 返回这个对象 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    return ref;
  }
}

// 更新ref
function updateRef<T>(initialValue: T): {current: T} {
  const hook = updateWorkInProgressHook();
  // 浅克隆
  // 这里重要的还是memoizedState属性
  // 其实就是current hook的memoizedState属性

  // 直接返回这个对象 // {current: value} ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return hook.memoizedState;
}

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// 挂载effect实现
function mountEffectImpl(
  fiberFlags,
  hookFlags,
  create,
  deps: Array<mixed> | void | null,
): void {
  const hook = mountWorkInProgressHook(); // 其实就是在wip的memoizedState放置hook对象

  const nextDeps = deps === undefined ? null : deps; // deps
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  currentlyRenderingFiber.flags |= fiberFlags; // PassiveEffect | PassiveStaticEffect // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


  // 给hook对象的memoizedState属性赋值effect对象
  // 这个函数实际上是创建effect环形链表且创建函数式组件的updateQueue挂载到wip的updateQueue属性上
  /* 
  给函数式组件创建的updateQueue属性
  {
      lastEffect: null,
      events: null,
      stores: null,
      memoCache: null,
    }
  */
  // 之后让updateQueue中的lastEffect指向effect环形链表的最后一个effect对象
  hook.memoizedState = pushEffect(
    HookHasEffect | hookFlags, // HookHasEffect | HookPassive
    create,
    undefined,
    nextDeps,
  );
}

// 更新effect实现 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateEffectImpl(
  fiberFlags,
  hookFlags,
  create,
  deps: Array<mixed> | void | null,
): void {
  
  const hook = updateWorkInProgressHook();
  // 主要还是复用current对应的hook对象的memoizedState
  // 因为它在effect里面是存储着effect对象的
  
  // 另外还要注意wip的updateQueue（它在renderWithHooks中在执行Component函数之前已经被置为null了） // +++++++++++++++++++++++++++


  const nextDeps = deps === undefined ? null : deps;
  let destroy = undefined;

  if (currentHook !== null) { // 此时current身上的hook对象
    const prevEffect = currentHook.memoizedState; // 取出它的effect对象

    // 在commitHookEffectListMount里面会去执行effect中的create函数，而这个函数返回的destroy函数直接存入到当时对应的effect中的destroy函数中
    // 在那个时期来讲最终变为了current，那么所以说这里就能够取出这个对应的destory函数的
    // 所以这里把它取出来然后放在了当前这个effect对象的destroy属性上，那么之后就可以提交卸载effect钩子函数啦 ~ // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    destroy = prevEffect.destroy; // 获取它的destory函数 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++0
    
    if (nextDeps !== null) {

      const prevDeps = prevEffect.deps; // current的hook上的memoizedState指向的effect的deps数组
      
      if (areHookInputsEqual(nextDeps, prevDeps)) { // 比较这两个数组
        // 一致的则提前 返回
        hook.memoizedState = pushEffect(hookFlags /** HookPassive【没有HookHasEffect标记】 */, create, destroy, nextDeps);
          // 给hook对象的memoizedState属性替换为新的effect对象
  // 这个函数【还是】实际上是创建effect环形链表且创建函数式组件的updateQueue挂载到wip的updateQueue属性上（因为在renderWithHooks函数中会在执行Component函数之前对wip的updateQueue属性置为null的）
  /* 
  给函数式组件创建的updateQueue属性
  {
      lastEffect: null,
      events: null,
      stores: null,
      memoCache: null,
    }
  */
  // 之后让updateQueue中的lastEffect指向effect环形链表的最后一个effect对象
        return; // 返回 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      }
    }
  }

  // 注意在createWorkInProgress函数中wip的flags正常情况下会被赋值为0的 // ++++++++++++++++++++++++++++++++++++++++++++++++++
  currentlyRenderingFiber.flags |= fiberFlags; // PassiveEffect

  hook.memoizedState = pushEffect(
    HookHasEffect | hookFlags, // HookHasEffect | HookPassive
    create,
    destroy,
    nextDeps,
  );
  // 给hook对象的memoizedState属性替换为新的effect对象 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // 这个函数【还是】实际上是创建effect环形链表且创建函数式组件的updateQueue挂载到wip的updateQueue属性上（***因为在renderWithHooks函数中会在执行Component函数之前对wip的updateQueue属性置为null的***）
  /* 
  给函数式组件创建的updateQueue属性
  {
      lastEffect: null,
      events: null,
      stores: null,
      memoCache: null,
    }
  */
  // 之后让updateQueue中的lastEffect指向effect环形链表的最后一个effect对象
}

// 挂载effect
function mountEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  if (
    __DEV__ &&
    (currentlyRenderingFiber.mode & StrictEffectsMode) !== NoMode
  ) {
    return mountEffectImpl(
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      MountPassiveDevEffect | PassiveEffect | PassiveStaticEffect, // 8390656 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      HookPassive,
      create,
      deps,
    );
  } else {
    // 挂载effect实现 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    return mountEffectImpl(
      PassiveEffect | PassiveStaticEffect, /** ***** */
      HookPassive, /** ***** */
      create,
      deps,
    );
  }
}

// 更新effect // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  return updateEffectImpl(PassiveEffect /** *就是packages/react-reconciler/src/ReactFiberFlags.js下的Passive* */, HookPassive /** *** */, create, deps); // 更新effect实现 // +++++++++++++++++++++++++++++++++++
}

function useEventImpl<Args, Return, F: (...Array<Args>) => Return>(
  payload: EventFunctionPayload<Args, Return, F>,
) {
  currentlyRenderingFiber.flags |= UpdateEffect;
  let componentUpdateQueue: null | FunctionComponentUpdateQueue = (currentlyRenderingFiber.updateQueue: any);
  if (componentUpdateQueue === null) {
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    currentlyRenderingFiber.updateQueue = (componentUpdateQueue: any);
    componentUpdateQueue.events = [payload];
  } else {
    const events = componentUpdateQueue.events;
    if (events === null) {
      componentUpdateQueue.events = [payload];
    } else {
      events.push(payload);
    }
  }
}

function mountEvent<Args, Return, F: (...Array<Args>) => Return>(
  callback: F,
): F {
  const hook = mountWorkInProgressHook();
  const ref = {impl: callback};
  hook.memoizedState = ref;
  // $FlowIgnore[incompatible-return]
  return function eventFn() {
    if (isInvalidExecutionContextForEventFunction()) {
      throw new Error(
        "A function wrapped in useEvent can't be called during rendering.",
      );
    }
    return ref.impl.apply(undefined, arguments);
  };
}

function updateEvent<Args, Return, F: (...Array<Args>) => Return>(
  callback: F,
): F {
  const hook = updateWorkInProgressHook();
  const ref = hook.memoizedState;
  useEventImpl({ref, nextImpl: callback});
  // $FlowIgnore[incompatible-return]
  return function eventFn() {
    if (isInvalidExecutionContextForEventFunction()) {
      throw new Error(
        "A function wrapped in useEvent can't be called during rendering.",
      );
    }
    return ref.impl.apply(undefined, arguments);
  };
}

function mountInsertionEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  return mountEffectImpl(UpdateEffect, HookInsertion, create, deps);
}

function updateInsertionEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  return updateEffectImpl(UpdateEffect, HookInsertion, create, deps);
}

// 挂载布局effect
function mountLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  let fiberFlags: Flags = UpdateEffect | LayoutStaticEffect; // 准备fiber标记 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  if (
    __DEV__ &&
    (currentlyRenderingFiber.mode & StrictEffectsMode) !== NoMode
  ) {
    fiberFlags |= MountLayoutDevEffect;
  }

  // 和useEffect在挂载使用的方法是一致的
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return mountEffectImpl(fiberFlags /**  */, HookLayout /** ****** */, create, deps); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

// 更新布局effect // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {

  // 和useEffect在更新使用的方法是一致的
  // 更新布局effect实现
  return updateEffectImpl(UpdateEffect /** ****** */, HookLayout /** ****** */, create, deps); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}


// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function imperativeHandleEffect<T>(
  create: () => T,
  ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
) {
  if (typeof ref === 'function') {
    const refCallback = ref;
    const inst = create();
    refCallback(inst);
    return () => {
      refCallback(null);
    };
  } else if (ref !== null && ref !== undefined) {


    const refObject = ref; // {current: initialValue} // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    
    
    if (__DEV__) {
      if (!refObject.hasOwnProperty('current')) {
        console.error(
          'Expected useImperativeHandle() first argument to either be a ' +
            'ref callback or React.createRef() object. Instead received: %s.',
          'an object with keys {' + Object.keys(refObject).join(', ') + '}',
        );
      }
    }


    const inst = create(); // 直接执行cb函数返回实例
    refObject.current = inst; // 直接作为current属性的值


    // 返回的destroy函数
    return () => {
      // 直接置为current为null即可啦 ~
      refObject.current = null;
    };
  }
}

// 挂载 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++==++++++++++++++++
function mountImperativeHandle<T>(
  ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
  create: () => T,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    if (typeof create !== 'function') {
      console.error(
        'Expected useImperativeHandle() second argument to be a function ' +
          'that creates a handle. Instead received: %s.',
        create !== null ? typeof create : 'null',
      );
    }
  }

  // TODO: If deps are provided, should we skip comparing the ref itself?
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null; // [dep, dep, ref]

  let fiberFlags: Flags = UpdateEffect | LayoutStaticEffect; // 准备标记，【和useLayoutEffect的标记是一样的】 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  if (
    __DEV__ &&
    (currentlyRenderingFiber.mode & StrictEffectsMode) !== NoMode
  ) {
    fiberFlags |= MountLayoutDevEffect;
  }

  // useEffect在挂载时使用的函数是一致的 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return mountEffectImpl(
    fiberFlags,
    HookLayout, // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    imperativeHandleEffect.bind(null, create, ref), // 绑定cb以及ref作为参数 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    effectDeps, // [dep, dep, ref]
  );
}

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// https://reactjs.org/docs/hooks-reference.html#useimperativehandle

// useImperativeHandle其实就是useRef以及useLayoutEffect的结合运用
// 更新完dom之后执行用户的cb拿到结果放在ref.current属性上
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

function updateImperativeHandle<T>(
  ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
  create: () => T,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    if (typeof create !== 'function') {
      console.error(
        'Expected useImperativeHandle() second argument to be a function ' +
          'that creates a handle. Instead received: %s.',
        create !== null ? typeof create : 'null',
      );
    }
  }

  // TODO: If deps are provided, should we skip comparing the ref itself?
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null; // [dep, dep, ref]

  // 和useEffect在更新时使用的一样的函数 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return updateEffectImpl(
    UpdateEffect,
    HookLayout, // 【和useLayoutEffect一致的】
    imperativeHandleEffect.bind(null, create, ref), // 
    effectDeps,
  );
}

function mountDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
  // This hook is normally a no-op.
  // The react-debug-hooks package injects its own implementation
  // so that e.g. DevTools can display custom hook values.
}

const updateDebugValue = mountDebugValue;

// 挂载cb
function mountCallback<T>(callback: T, deps: Array<mixed> | void | null): T {

  const hook = mountWorkInProgressHook(); // 在wip身上继续挂载一个hook对象，可能已经形成一个hook链表了
  // wip.memoizedState = hook1 -> hook2
  
  const nextDeps = deps === undefined ? null : deps;


  hook.memoizedState = [callback, nextDeps]; // 直接做一个数组存放在hook对象的memoizedState属性上
  
  // 返回这个cb函数 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return callback;
}

// 更新cb // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateCallback<T>(callback: T, deps: Array<mixed> | void | null): T {

  const hook = updateWorkInProgressHook();
  // 形成一个hook链表，对于这个hook对象它是浅克隆current hook的
  // 也就是说对于这里的hook.memoizedState实际上是current hook的memoizedState
  // 它在这里是一个数组[cb, deps] - current
  
  
  const nextDeps = deps === undefined ? null : deps;

  const prevState = hook.memoizedState; // current hook的memoizedState
  
  if (prevState !== null) { // 之前状态不为null
    if (nextDeps !== null) { // 现在的deps不为null

      const prevDeps: Array<mixed> | null = prevState[1]; // 之前的deps
      
      if (areHookInputsEqual(nextDeps, prevDeps)) { // 现在的deps和之前的deps如果是一样的
        /* 
        function areHookInputsEqual(
  nextDeps: Array<mixed>,
  prevDeps: Array<mixed> | null,
) {
  if (__DEV__) {
    if (ignorePreviousDependencies) {
      // Only true when this component is being hot reloaded.
      return false;
    }
  }

  if (prevDeps === null) {
    if (__DEV__) {
      console.error(
        '%s received a final argument during this render, but not during ' +
          'the previous render. Even though the final argument is optional, ' +
          'its type cannot change between renders.',
        currentHookNameInDev,
      );
    }
    return false;
  }

  if (__DEV__) {
    // Don't bother comparing lengths in prod because these arrays should be
    // passed inline.
    if (nextDeps.length !== prevDeps.length) {
      console.error(
        'The final argument passed to %s changed size between renders. The ' +
          'order and size of this array must remain constant.\n\n' +
          'Previous: %s\n' +
          'Incoming: %s',
        currentHookNameInDev,
        `[${prevDeps.join(', ')}]`,
        `[${nextDeps.join(', ')}]`,
      );
    }
  }
  // $FlowFixMe[incompatible-use] found when upgrading Flow

  // 循环遍历
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    // $FlowFixMe[incompatible-use] found when upgrading Flow

    
    if (is(nextDeps[i], prevDeps[i])) { // shared/objectIs - 实际上是Object.is算法 api // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      continue;
    }
    return false;
  }
  return true;
}
        */

        // 那么直接返回的是之前的cb
        return prevState[0]; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      }
    }
  }

  // 变化了则
  // 更新wip hook的memoizedState
  hook.memoizedState = [callback, nextDeps]; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 返回新的cb
  return callback;
}

// 挂载memo
function mountMemo<T>(
  nextCreate: () => T,
  deps: Array<mixed> | void | null,
): T {
  const hook = mountWorkInProgressHook();
  // 形成hook链表

  const nextDeps = deps === undefined ? null : deps;

  const nextValue = nextCreate(); // 直接执行这个函数，使用它所返回的值


  // 存储在hook对象的memoizedState属性上 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  hook.memoizedState = [nextValue, nextDeps]; // [cb的返回值, deps]
  
  // 返回cb执行的返回值
  return nextValue;
}

// 更新memo
function updateMemo<T>(
  nextCreate: () => T,
  deps: Array<mixed> | void | null,
): T {
  const hook = updateWorkInProgressHook();
  // 浅克隆current hook
  // 这里也是主要是hook的memoizedState属性
  // 因为其实它是current hook的memoizedState属性 - [val, deps] - current

  const nextDeps = deps === undefined ? null : deps;

  const prevState = hook.memoizedState; // 之前的状态
  
  if (prevState !== null) { // 之前的状态不为null
    // Assume these are defined. If they're not, areHookInputsEqual will warn.
    if (nextDeps !== null) { // 新的deps不为null

      const prevDeps: Array<mixed> | null = prevState[1]; // 之前的deps
      
      if (areHookInputsEqual(nextDeps, prevDeps)) { // 循环遍历数组 - 使用Object.is算法一一按顺序位置进行比较
        // 若是一样的那么直接采用之前的值
        return prevState[0]; // 返回之前的值
      }
    }
  }

  // 不一样则
  // 直接执行新的cb - 采用它的返回值
  const nextValue = nextCreate(); // 新的返回值

  // 【更新】hook的memoizedState属性
  hook.memoizedState = [nextValue, nextDeps]; // 新的

  // 返回新的value
  return nextValue;
}

// 挂载推迟的值
function mountDeferredValue<T>(value: T): T {
  const hook = mountWorkInProgressHook();
  // 形成hook链表

  hook.memoizedState = value; // 直接把value放在hook对象的memoizedState属性上

  // 返回value值 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
  return value;
}


// 更新推迟的值
function updateDeferredValue<T>(value: T): T {
  const hook = updateWorkInProgressHook();
  // 浅克隆
  // 主要时hook对象的memoizedState属性 - 其实就是current hook的memoizedState属性
  // 就是之前的value

  const resolvedCurrentHook: Hook = (currentHook: any); // current hook

  const prevValue: T = resolvedCurrentHook.memoizedState; // 取出之前的value // ++++++++++++++++++++++++++++++++++++++++++++++


  /// 更新推迟的值实现 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return updateDeferredValueImpl(hook, prevValue, value);
}

function rerenderDeferredValue<T>(value: T): T {
  const hook = updateWorkInProgressHook();
  if (currentHook === null) {
    // This is a rerender during a mount.
    hook.memoizedState = value;
    return value;
  } else {
    // This is a rerender during an update.
    const prevValue: T = currentHook.memoizedState;
    return updateDeferredValueImpl(hook, prevValue, value);
  }
}

/// 更新推迟的值实现
function updateDeferredValueImpl<T>(hook: Hook, prevValue: T, value: T): T {

  /* 
  在renderWithHooks中
    renderLanes = nextRenderLanes;
  */

  // urgent: 紧迫的
  const shouldDeferValue = !includesOnlyNonUrgentLanes(renderLanes); // renderLanes表示当前渲染车道集合 // ++++++++++++++++++++++++++++++++++++++++++
  /* 
  export function includesOnlyNonUrgentLanes(lanes: Lanes): boolean {
    const UrgentLanes = SyncLane | InputContinuousLane | DefaultLane;
    return (lanes & UrgentLanes) === NoLanes;
  }
  */
  // 是否应该推迟值

  // 应该推迟 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  if (shouldDeferValue) {
    // This is an urgent update. If the value has changed, keep using the
    // previous value and spawn a deferred render to update it later.

    // Object.is算法对比这两个值是否相等
    if (!is(value, prevValue)) { // 不相等 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

      // ./ReactFiberLane.new.js
      // 调度一个延迟渲染
      // Schedule a deferred render
      const deferredLane = claimNextTransitionLane(); // 延迟车道 // 64
      /* 
      export function claimNextTransitionLane(): Lane {
        // Cycle through the lanes, assigning each new transition to the next lane.
        // In most cases, this means every transition gets its own lane, until we
        // run out of lanes and cycle back to the beginning.
        const lane = nextTransitionLane; // nextTransitionLane默认就是TransitionLane1
        nextTransitionLane <<= 1; // 左移 -> TransitionLane2 -> 再左移变为TransitionLane3
        if ((nextTransitionLane & TransitionLanes) === NoLanes) { // 到达边界不是过渡车道啦那么直接恢复为TransitionLane1 // ++++++
          nextTransitionLane = TransitionLane1; // 回到TransitionLane1这个值
        }
        return lane; // TransitionLane1 // 64
      }
      */


      currentlyRenderingFiber.lanes = mergeLanes(
        currentlyRenderingFiber.lanes,
        deferredLane,
      ); // 合并这个延迟车道给wip fiber的lanes // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

      /* 
      packages/react-reconciler/src/ReactFiberCompleteWork.new.js
      在completeWork中的bubbleProperties中对于wip来讲只会【向下收集一层孩子】的flags和subTreeFlags到wip的subTreeFlags上
      另外也只会【向下收集一层孩子】的lanes和childLanes到wip的childLanes上（ // +++防止无限执行ensureRootIsScheduled函数的关键代码3）
      
      以下面这个例子为准，那么所以在commitRoot函数执行之前root.current.alternate.childLanes为64
      const { useState, useEffect, useDeferredValue } = React
      const { createRoot } = ReactDOM
      function App() {
        const [count, setCount] = useState(0)
        const deferredCount = useDeferredValue(count)

        return (
          <button onClick={() => {
              setCount(count => count + 1)
            }}>
            <p>count is {count}</p>
            <p>deferred count is {deferredCount}</p>
          </button>
        )
      }

      createRoot(document.getElementById('root'))
        .render(<App/>)
      
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

      packages/react-reconciler/src/ReactFiberWorkLoop.new.js
      commitRootImpl下的
        ...
        // wip // ++++++
        let remainingLanes = mergeLanes(finishedWork.lanes, finishedWork.childLanes); // return (finishedWork.lanes | finishedWork.childLanes)
        // 得出剩余的车道集合
        ...
        markRootFinished(root, remainingLanes);
          ...
          root.pendingLanes = remainingLanes;
          ...
        ...
        // +++防止无限执行ensureRootIsScheduled函数的关键代码1
        // 替换current树 // 要注意 重点 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        // 要注意换了current了 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        root.current = finishedWork; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        ...
        ensureRootIsScheduled(root, now()); // 再一次执行ensureRootIsScheduled函数
        ...
       
      从上面的逻辑中可以看出它再一次的进行ensureRootIsScheduled的调用执行，具体详细可查看ensureRootIsScheduled函数
      

      // 所以最终表现就是当点击1次之后会把之前的值commit到页面上去，然后之后又进行了ensureRootIsScheduled函数的调用
      // 再一次把root.pendingLanes取出作为remainingLanes得出nextLanes，然后再得出newCallbackPriority
      // 再经过scheduleCallback调度performConcurrentWorkOnRoot函数
      // 之后进行一系列的操作再次运行到这里那么此时的renderLanes就是64了，所以【不应该延迟】
      // 那么下面也就返回了新的值啦 ~

      // 所以点击了1次结果是提交了2次，但是修改dom只为1次（提交旧值一次但是由于【diff的原因则不会修改dom】）、最终提交新值一次所以修改dom一次）
      // 他这样做的效果非常的像debouncing or throttling（节流或防抖）
      // 类似于输入框不断的输入并不是每次的输入都会伴随着一次的修改dom
      // 他这里先是提交旧值但由于diff原因不会修改dom，然后之后开始通过【宏任务】调度了一个异步渲染performConcurrentWorkOnRoot（这里的修改lanes逻辑导致的）（这个是为了提交新值+++）
      // 但如果此时还在输入（onChange、onClick、onInput都是同步车道 1）那么在ensureRootIsScheduled函数中的逻辑里面由于不是同优先级的（因为修改状态要通过dispatchSetState -> requestUpdateLane）
      // 那么它请求到的车道就是1 同步车道，而本次的车道和上一次的车道不一样
      // 所以直接取消上一次的任务，重新调度一个新的任务那么此时产生的是一个【微任务】且是performSyncWorkOnRoot
      
      // 要注意在操作状态的改变会通过scheduleUpdateOnFiber函数 -> 再去ensureRootIsScheduled函数
      // 而在scheduleUpdateOnFiber函数中有这样的逻辑
      //   标记root有一个【待处理的更新】 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      //   Mark that the root has a pending update.
      //   markRootUpdated(root, lane, eventTime); // root.pendingLanes |= lane // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++（重要的）
      //   16
      //   标记root更新 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // 那么所以说即使这个被重用然后当前return也不用怕的，因为已经标记了root.pendingLanes了
      // 那么在commitRootImpl函数中也是再次执行了ensureRootIsScheduled函数的，所以就是这样来来回回被确保root是【完全被调度】的，【直到没有待处理的车道集合】
      
      // ++++++


      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // 一定要注意prepareFreshStack和createWorkInProgress函数
        workInProgress.flags = current.flags & StaticMask; // & StaticMask +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        workInProgress.childLanes = current.childLanes; // +++++++++++++++++++++++++++++++++++++++++++
        workInProgress.lanes = current.lanes; // +++++++++++++++++++++++++++++++++++++++++++++++++++++
      
      但是在beginWork时再调用updateFunctionComponent之前有这样一句代码workInProgress.lanes = NoLanes; // +++防止无限执行ensureRootIsScheduled函数的关键代码2
      // 这是重点，所以在再次执行到这里的时候就是【不应该延迟值】了那么也不会对它的lanes做改变，所以在completeWork中的bubbleProperties函数中对于workInProgress的childLanes（ // +++防止无限执行ensureRootIsScheduled函数的关键代码3）
      就不会再有，那么在上面的得出剩余的车道集合时就不会有，那么再对于下面的ensureRootIsScheduled就会直接return啦 ~
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


      ensureRootIsScheduled函数剩余的逻辑：

        ...
      
        // 确定下一个要处理的通道及其优先级。
        // Determine the next lanes to work on, and their priority.
        // packages/react-reconciler/src/ReactFiberLane.new.js
        const nextLanes = getNextLanes( // 获取下一个车道集合 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
          root,
          root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes, // false -> 0 // +++++++++++++++++++++++++++++++++++++++++++++++++++++
        ); // 16
        // 64 // +++

        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        // setTimeout下16
        // react的click下1
        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

        // 下一车道是NoLanes
        if (nextLanes === NoLanes) { // ++++++++++++++++++++++++++++++++++++++++++++++
          // 特殊情况：没有什么可做的。
          // Special case: There's nothing to work on.
          if (existingCallbackNode !== null) {
            cancelCallback(existingCallbackNode); // 取消cb
          }
          // 重置状态并return // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++
          root.callbackNode = null;
          root.callbackPriority = NoLane;
          /// +++++++++++++++++++++++++++++++++++++++++++++++++
          return; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
          // ++++++++++++++++++++++++++++++++++++++++++++++++++++
        }

        ...

        let schedulerPriorityLevel;
        // 车道转为事件优先级
        // packages/react-reconciler/src/ReactEventPriorities.new.js
        // lanesToEventPriority函数
        switch (lanesToEventPriority(nextLanes)) { // 64 -> DefaultEventPriority: 16
          case DiscreteEventPriority:
            schedulerPriorityLevel = ImmediateSchedulerPriority; // 1
            break;
          case ContinuousEventPriority:
            schedulerPriorityLevel = UserBlockingSchedulerPriority; // 2
            break;
          case DefaultEventPriority: // DefaultEventPriority 16 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++
            // 与之对应的调度优先级为正常调度优先级 // +++++++++++++++++++++++++++++++++++++++++++++++++
            schedulerPriorityLevel = NormalSchedulerPriority; // 3
            break;
          case IdleEventPriority:
            schedulerPriorityLevel = IdleSchedulerPriority; // 5
            break;
          default:
            schedulerPriorityLevel = NormalSchedulerPriority; // 3
            break;
        }
        // +++调度回调+++
        // 返回一个新回调节点
        // 其实就是一个任务对象（task对象）
        newCallbackNode = scheduleCallback( // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
          schedulerPriorityLevel, // 3
          // 在root上执行并发工作 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
          performConcurrentWorkOnRoot.bind(null, root), // 绑定FiberRootNode
          // 调度performConcurrentWorkOnRoot这个函数
        ); // 再一次使用scheduleCallback进行调度performConcurrentWorkOnRoot这个函数 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      */
      


      
      
      


      // ./ReactFiberWorkLoop.new.js
      // 标记跳过的更新车道集合 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
      markSkippedUpdateLanes(deferredLane);
      /* 
      export function markSkippedUpdateLanes(lane: Lane | Lanes): void {
        workInProgressRootSkippedLanes = mergeLanes(
          lane,
          workInProgressRootSkippedLanes,
        );
      }
      */

      // Set this to true to indicate that the rendered value is inconsistent
      // from the latest value. The name "baseState" doesn't really match how we
      // use it because we're reusing a state hook field instead of creating a
      // new one.
      hook.baseState = true; // 标记 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }

    // 重新使用之前的值 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // Reuse the previous value
    return prevValue;
  } else {

    // 不应该推迟 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    // This is not an urgent update, so we can use the latest value regardless
    // of what it is. No need to defer it.

    // However, if we're currently inside a spawned render, then we need to mark
    // this as an update to prevent the fiber from bailing out.
    //
    // `baseState` is true when the current value is different from the rendered
    // value. The name doesn't really match how we use it because we're reusing
    // a state hook field instead of creating a new one.
    if (hook.baseState) {
      // Flip this back to false.
      hook.baseState = false; // 标记为false
      markWorkInProgressReceivedUpdate(); // 标记
      /* 
      ./ReactFiberBeginWork.new.js

      export function markWorkInProgressReceivedUpdate() {
        didReceiveUpdate = true;
      }
      */
    }

    // 那么直接把新的value放在hook对象的memoizedState属性上即可
    hook.memoizedState = value;
    return value;
  }
}

/* 
https://reactjs.org/docs/hooks-reference.html#usetransition

function App() {
  const [isPending, startTransition] = useTransition()
  const [count, setCount] = useState(0)
  
  function handleClick() {
    startTransition(() => {
      setCount(c => c + 1)
    })
  }

  return (
    <div>
      {isPending && <Spinner />}
      <button onClick={handleClick}>{count}</button>
    </div>
  )
}
*/
// 开始过渡 // +++
function startTransition(setPending, callback, options) {
  const previousPriority = getCurrentUpdatePriority(); // 获取currentUpdatePriority

  /* 
  ./ReactEventPriorities.new.js
  // 离散事件优先级
export const DiscreteEventPriority: EventPriority = SyncLane; // 同步车道 // 1 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 连续事件优先级
export const ContinuousEventPriority: EventPriority = InputContinuousLane; // 4 // +++

// 当前更新优先级
let currentUpdatePriority: EventPriority = NoLane; // 默认为NoLane
  */

  // 设置currentUpdatePriority
  setCurrentUpdatePriority(
    higherEventPriority(previousPriority, ContinuousEventPriority), // 返回两者之间较小的那一个
  );
  /* 
  ./ReactEventPriorities.new.js
  export function higherEventPriority(
    a: EventPriority,
    b: EventPriority,
  ): EventPriority {
    return a !== 0 && a < b ? a : b;
  }
  */

  // 在scheduleUpdateOnFiber中触发一个微任务且是执行performSyncWorkOnRoot
  /* 
  dispatchSetState -> scheduleUpdateOnFiber -> entangleTransitionUpdate（具体查看此方法）
  */
  setPending(true); // 设置状态为true

  const prevTransition = ReactCurrentBatchConfig.transition; // +++
  
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  ReactCurrentBatchConfig.transition = {}; // 这里设置了一个空对象{} +++++++++++++++++++++++++++++++++++++++++++++++++++
  /* 
  这个赋值将会直接影响下面的函数
  requestUpdateLane -> 64 过渡1车道 -> 过渡2车道 -> 过渡3车道

  scheduleUpdateOnFiber
  entangleTransitionUpdate
  */

  const currentTransition = ReactCurrentBatchConfig.transition; // +++

  if (enableTransitionTracing) {
    if (options !== undefined && options.name !== undefined) {
      ReactCurrentBatchConfig.transition.name = options.name;
      ReactCurrentBatchConfig.transition.startTime = now();
    }
  }

  if (__DEV__) {
    ReactCurrentBatchConfig.transition._updatedFibers = new Set();
  }

  try {
    
    // 在scheduleUpdateOnFiber中取消上一次的任务，并安排一个新的宏任务处理performConcurrentWorkOnRoot
    // 这里requestUpdateLane就为【过渡1车道了】
    /* 
    dispatchSetState -> scheduleUpdateOnFiber -> entangleTransitionUpdate（具体查看此方法）
    */
    setPending(false); // 紧接着再设置为false

    // 执行cb - 因为cb中会去修改状态 - dispatchSetState -> scheduleUpdateOnFiber -> entangleTransitionUpdate（具体查看此方法）
    // 在这个scheduleUpdateOnFiber中requestUpdateLane就为【过渡2车道了】那么所以也是取消上一次的任务，并安排一个新的宏任务处理performConcurrentWorkOnRoot

    // 那么在performConcurrentWorkOnRoot中是否shouldTimeSlice呢？
      // const shouldTimeSlice = // 是否应该时间切片
      // !includesBlockingLane(root, lanes) && // 是否包含阻塞车道 // !true // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // !includesExpiredLane(root, lanes) && // 是否包含过期车道
      // (disableSchedulerTimeoutInWorkLoop || !didTimeout); // 是否禁用调度器超时工作环 或者 没有超时
    // 答案是肯定的时间切片
    // 那么直接执行renderRootConcurrent而不是renderRootSync
    // 【时间切片】啦 ~
    callback(); // 直接执行cb函数
  } finally {

    // 恢复之前的currentUpdatePriority
    setCurrentUpdatePriority(previousPriority);

    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // 再赋值为之前的过渡值，应该是为null了！！！
    ReactCurrentBatchConfig.transition = prevTransition; // 重要 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    if (__DEV__) {
      if (prevTransition === null && currentTransition._updatedFibers) {
        const updatedFibersCount = currentTransition._updatedFibers.size;
        if (updatedFibersCount > 10) {
          console.warn(
            'Detected a large number of updates inside startTransition. ' +
              'If this is due to a subscription please re-write it to use React provided hooks. ' +
              'Otherwise concurrent mode guarantees are off the table.',
          );
        }
        currentTransition._updatedFibers.clear();
      }
    }
  }
}

// 挂载
function mountTransition(): [
  boolean,
  (callback: () => void, options?: StartTransitionOptions) => void,
] {

  // useState的挂载时期的逻辑
  const [isPending, setPending] = mountState(false); // 挂载状态isPending - 默认值为false

  // 这个start方法是从不改变的 // ++++++
  // The `start` method never changes.
  const start = startTransition.bind(null, setPending); // 给startTransition绑定一个更改isPending的函数

  const hook = mountWorkInProgressHook();
  // 再次形成一个关于当前的hook对象放置在hook链表上

  // hook对象属性的memoizedState存储start函数
  hook.memoizedState = start;

  return [isPending, start]; // 返回这个集合
}

// 更新
function updateTransition(): [
  boolean,
  (callback: () => void, options?: StartTransitionOptions) => void,
] {
  const [isPending] = updateState(false); // 更新状态

  const hook = updateWorkInProgressHook();
  // 还是浅克隆
  // 当前重要的是hook.memoizedState其实就是current hook的memoizedState属性

  const start = hook.memoizedState; // 还是start函数


  return [isPending, start]; // 返回
}

function rerenderTransition(): [
  boolean,
  (callback: () => void, options?: StartTransitionOptions) => void,
] {
  const [isPending] = rerenderState(false);
  const hook = updateWorkInProgressHook();
  const start = hook.memoizedState;
  return [isPending, start];
}

let isUpdatingOpaqueValueInRenderPhase = false;
export function getIsUpdatingOpaqueValueInRenderPhaseInDEV(): boolean | void {
  if (__DEV__) {
    return isUpdatingOpaqueValueInRenderPhase;
  }
}

function mountId(): string {
  const hook = mountWorkInProgressHook();

  const root = ((getWorkInProgressRoot(): any): FiberRoot);
  // TODO: In Fizz, id generation is specific to each server config. Maybe we
  // should do this in Fiber, too? Deferring this decision for now because
  // there's no other place to store the prefix except for an internal field on
  // the public createRoot object, which the fiber tree does not currently have
  // a reference to.
  const identifierPrefix = root.identifierPrefix;

  let id;
  if (getIsHydrating()) {
    const treeId = getTreeId();

    // Use a captial R prefix for server-generated ids.
    id = ':' + identifierPrefix + 'R' + treeId;

    // Unless this is the first id at this level, append a number at the end
    // that represents the position of this useId hook among all the useId
    // hooks for this fiber.
    const localId = localIdCounter++;
    if (localId > 0) {
      id += 'H' + localId.toString(32);
    }

    id += ':';
  } else {
    // Use a lowercase r prefix for client-generated ids.
    const globalClientId = globalClientIdCounter++;
    id = ':' + identifierPrefix + 'r' + globalClientId.toString(32) + ':';
  }

  hook.memoizedState = id;
  return id;
}

function updateId(): string {
  const hook = updateWorkInProgressHook();
  const id: string = hook.memoizedState;
  return id;
}

function mountRefresh() {
  const hook = mountWorkInProgressHook();
  const refresh = (hook.memoizedState = refreshCache.bind(
    null,
    currentlyRenderingFiber,
  ));
  return refresh;
}

function updateRefresh() {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;
}

function refreshCache<T>(fiber: Fiber, seedKey: ?() => T, seedValue: T) {
  if (!enableCache) {
    return;
  }
  // TODO: Does Cache work in legacy mode? Should decide and write a test.
  // TODO: Consider warning if the refresh is at discrete priority, or if we
  // otherwise suspect that it wasn't batched properly.
  let provider = fiber.return;
  while (provider !== null) {
    switch (provider.tag) {
      case CacheComponent:
      case HostRoot: {
        // Schedule an update on the cache boundary to trigger a refresh.
        const lane = requestUpdateLane(provider);
        const eventTime = requestEventTime();
        const refreshUpdate = createLegacyQueueUpdate(eventTime, lane);
        const root = enqueueLegacyQueueUpdate(provider, refreshUpdate, lane);
        if (root !== null) {
          scheduleUpdateOnFiber(root, provider, lane, eventTime);
          entangleLegacyQueueTransitions(root, provider, lane);
        }

        // TODO: If a refresh never commits, the new cache created here must be
        // released. A simple case is start refreshing a cache boundary, but then
        // unmount that boundary before the refresh completes.
        const seededCache = createCache();
        if (seedKey !== null && seedKey !== undefined && root !== null) {
          if (enableLegacyCache) {
            // Seed the cache with the value passed by the caller. This could be
            // from a server mutation, or it could be a streaming response.
            seededCache.data.set(seedKey, seedValue);
          } else {
            if (__DEV__) {
              console.error(
                'The seed argument is not enabled outside experimental channels.',
              );
            }
          }
        }

        const payload = {
          cache: seededCache,
        };
        refreshUpdate.payload = payload;
        return;
      }
    }
    provider = provider.return;
  }
  // TODO: Warn if unmounted?
}

// 派发reducer行为 // +++
function dispatchReducerAction<S, A>(
  fiber: Fiber,
  queue: UpdateQueue<S, A>,
  action: A, // {type: 'xxx'}
) {
  if (__DEV__) {
    if (typeof arguments[3] === 'function') {
      console.error(
        "State updates from the useState() and useReducer() Hooks don't support the " +
          'second callback argument. To execute a side effect after ' +
          'rendering, declare it in the component body with useEffect().',
      );
    }
  }

  // 还是请求更新车道
  const lane = requestUpdateLane(fiber);

  // 依然是准给update对象
  const update: Update<S, A> = {
    lane,
    action, // action对象 // +++
    hasEagerState: false,
    eagerState: null,
    next: (null: any),
  };

  // 是否为渲染阶段的更新
  if (isRenderPhaseUpdate(fiber)) {
    enqueueRenderPhaseUpdate(queue, update); // 入队列渲染阶段的更新 // +++
  } else {

    /* 
    这里的逻辑和useState的dispatchSetState函数不同 - dispatchSetState函数多了额外的逻辑 // +++
    */

    // 入队列并发钩子更新
    // 在./ReactFiberConcurrentUpdates.new.js下 - 简单点其实就是把这四个参数存在数组中
    const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
    // 返回FiberRootNode

    if (root !== null) {
      const eventTime = requestEventTime();
      // ./ReactFiberWorkLoop.new.js中scheduleUpdateOnFiber函数
      scheduleUpdateOnFiber(root, fiber, lane, eventTime); // 依旧是在fiber上调度更新 // +++
      entangleTransitionUpdate(root, queue, lane); // 纠缠过渡更新 // +++
    }
  }

  markUpdateInDevTools(fiber, lane, action);
}

// 派发设置状态 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function dispatchSetState<S, A>(
  fiber: Fiber,
  queue: UpdateQueue<S, A>,
  action: A,
) {
  if (__DEV__) {
    if (typeof arguments[3] === 'function') {
      console.error(
        "State updates from the useState() and useReducer() Hooks don't support the " +
          'second callback argument. To execute a side effect after ' +
          'rendering, declare it in the component body with useEffect().',
      );
    }
  }

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // dispatchSetState函数绑定的fiber一直都是右边这棵树中的fiber节点（也就是在mountState函数中所做的事情） // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // 而queue也是在此期间创建好后的queue对象
  // 一直没有变化过
  /* 
  FiberRootNode
   |
   |current
   |
  \ /
  FiberNode  <--alternate-->  FiberNode（workInProgress）
  */
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // 请求更新车道 | 64
  const lane = requestUpdateLane(fiber); // 请求更新车道 // 1
  // 通过react中click事件的话这里请求到的更新车道为1 同步车道
  // 而脱离react如setTimeout中执行dispatchSetState函数的话这里获取到的更新车道就是16 默认车道
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=

  // 准备update对象
  const update: Update<S, A> = {
    lane, // 车道
    action, // action参数
    hasEagerState: false, // 是否有急切的状态
    eagerState: null, // 急切的状态
    next: (null: any), // 下一个
    // 形成环形链表
  };

  // 是否为渲染阶段的更新
  if (isRenderPhaseUpdate(fiber)) { // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
    // 入队列渲染阶段更新
    enqueueRenderPhaseUpdate(queue, update); // +++++++++++++++++++++++++++++++++++++++++++++++++
  } else {
    // current fiber
    const alternate = fiber.alternate; // 取出它的alternate属性

    // 这个fiber一直是右树在mountState时绑定的fiber（要注意！）
    if (
      fiber.lanes === NoLanes /** === 0 */ && // 查看fiber的lanes
      (alternate === null || alternate.lanes === NoLanes) // alternate是否为null或者alternate的lanes是否为0
    ) {
      // The queue is currently empty, which means we can eagerly compute the
      // next state before entering the render phase. If the new state is the
      // same as the current state, we may be able to bail out entirely.
      const lastRenderedReducer = queue.lastRenderedReducer; // basicStateReducer // +++++++++++++++++++++++++++++++++++++++++++++++++++++++
      if (lastRenderedReducer !== null) { // 不为null
        let prevDispatcher;
        if (__DEV__) {
          prevDispatcher = ReactCurrentDispatcher.current;
          ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
        }
        try {
          const currentState: S = (queue.lastRenderedState: any); // 取出queue中上一次渲染的状态
          const eagerState = lastRenderedReducer(currentState, action); // 执行basicStateReducer函数 - 得到急切的状态
          // Stash the eagerly computed state, and the reducer used to compute
          // it, on the update object. If the reducer hasn't changed by the
          // time we enter the render phase, then the eager state can be used
          // without calling the reducer again.
          update.hasEagerState = true; /// 标记update对象有急切的状态
          update.eagerState = eagerState; // 赋值急切的状态

          if (is(eagerState, currentState)) { // Object.is算法是否相等 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
            // Fast path. We can bail out without scheduling React to re-render.
            // It's still possible that we'll need to rebase this update later,
            // if the component re-renders for a different reason and by that
            // time the reducer has changed.
            // TODO: Do we still need to entangle transitions in this case?
            enqueueConcurrentHookUpdateAndEagerlyBailout(fiber, queue, update);
            return; // 相等的那么直接返回
          }
        } catch (error) {
          // Suppress the error. It will throw again in the render phase.
        } finally {
          if (__DEV__) {
            ReactCurrentDispatcher.current = prevDispatcher;
          }
        }
      }
    }

    // 入队列并发hook更新
    // 在./ReactFiberConcurrentUpdates.new.js下 - 简单点其实就是把这四个参数存在数组中
    const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane); // 返回的是FiberRootNode
    if (root !== null) {
      const eventTime = requestEventTime(); // 请求事件时间

      // ./ReactFiberWorkLoop.new.js中scheduleUpdateOnFiber函数
      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      scheduleUpdateOnFiber(root, fiber, lane, eventTime); // 在fiber上调度更新 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      entangleTransitionUpdate(root, queue, lane); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }
  }

  markUpdateInDevTools(fiber, lane, action);
}

// 是否为渲染阶段的更新 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
function isRenderPhaseUpdate(fiber: Fiber) {
  const alternate = fiber.alternate; // 取出当前fiber的alternate属性也就是对应的current
  return (
    // 这个fiber是否和currentlyRenderingFiber全局一样的 - 这个变量在renderWithHooks中执行Component函数之前赋值的
    fiber === currentlyRenderingFiber ||
    (alternate !== null && alternate === currentlyRenderingFiber) // 或者alternate不是null且alternate是currentlyRenderingFiber
  );
}

// 入队列渲染阶段更新 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function enqueueRenderPhaseUpdate<S, A>(
  queue: UpdateQueue<S, A>,
  update: Update<S, A>,
) {
  // This is a render phase update. Stash it in a lazily-created map of
  // queue -> linked list of updates. After this render pass, we'll restart
  // and apply the stashed updates on top of the work-in-progress hook.
  
  didScheduleRenderPhaseUpdateDuringThisPass = didScheduleRenderPhaseUpdate = true; // 更改这两个全局变量为true - 这样在renderWithHooks中执行完Component函数之后
  // 通过判断didScheduleRenderPhaseUpdateDuringThisPass为true，那么便会再一次进行执行Component函数的
  // 而这一次在执行之前会把ReactCurrentDispatcher.current变更为HooksDispatcherOnRerenderInDEV // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 看一下queue（dispatchSetState函数绑定的那个queue）
  const pending = queue.pending; // pending环形链表
  // 构建环形链表
  if (pending === null) {
    // This is the first update. Create a circular list.
    update.next = update;
  } else {
    update.next = pending.next;
    pending.next = update;
  }
  // 始终指向环形链表的尾部 - 这样的目的在于能够直接通过它的next获取到环形链表的第一个update对象 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  queue.pending = update;
}

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// TODO: Move to ReactFiberConcurrentUpdates?
function entangleTransitionUpdate<S, A>(
  root: FiberRoot,
  queue: UpdateQueue<S, A>,
  lane: Lane,
) {

  // 是否为过渡车道 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  if (isTransitionLane(lane)) {
    // // 是否为过渡车道集合
    // export function isTransitionLane(lane: Lane): boolean {
    //   // const TransitionLanes: Lanes = /*                       */ 0b0000000001111111111111111000000; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
    //   return (lane & TransitionLanes) !== NoLanes;
    // }

    let queueLanes = queue.lanes;

    // If any entangled lanes are no longer pending on the root, then they
    // must have finished. We can remove them from the shared queue, which
    // represents a superset of the actually pending lanes. In some cases we
    // may entangle more than we need to, but that's OK. In fact it's worse if
    // we *don't* entangle when we should.
    queueLanes = intersectLanes(queueLanes, root.pendingLanes); // 交叉车道集合
    /* 
    // 交叉车道集合 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    export function intersectLanes(a: Lanes | Lane, b: Lanes | Lane): Lanes {
      return a & b; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }
    */

    // 将新的过渡车道与其他过渡车道纠缠在一起。
    // Entangle the new transition lane with the other transition lanes.
    const newQueueLanes = mergeLanes(queueLanes, lane); // return queueLanes | lane // +++++++++++++++++++++++++++++++++++++++++++
    queue.lanes = newQueueLanes; // 重新设置 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // Even if queue.lanes already include lane, we don't know for certain if
    // the lane finished since the last time we entangled it. So we need to
    // entangle it again, just to be sure.
    markRootEntangled(root, newQueueLanes);
    /* 
    ...
    root.entangledLanes |= entangledLanes // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    ...
    */
  }
}

function markUpdateInDevTools<A>(fiber, lane, action: A) {
  if (__DEV__) {
    if (enableDebugTracing) {
      if (fiber.mode & DebugTracingMode) {
        const name = getComponentNameFromFiber(fiber) || 'Unknown';
        logStateUpdateScheduled(name, lane, action);
      }
    }
  }

  if (enableSchedulingProfiler) {
    markStateUpdateScheduled(fiber, lane);
  }
}

export const ContextOnlyDispatcher: Dispatcher = {
  readContext,

  useCallback: throwInvalidHookError,
  useContext: throwInvalidHookError,
  useEffect: throwInvalidHookError,
  useImperativeHandle: throwInvalidHookError,
  useInsertionEffect: throwInvalidHookError,
  useLayoutEffect: throwInvalidHookError,
  useMemo: throwInvalidHookError,
  useReducer: throwInvalidHookError,
  useRef: throwInvalidHookError,
  useState: throwInvalidHookError,
  useDebugValue: throwInvalidHookError,
  useDeferredValue: throwInvalidHookError,
  useTransition: throwInvalidHookError,
  useMutableSource: throwInvalidHookError,
  useSyncExternalStore: throwInvalidHookError,
  useId: throwInvalidHookError,

  unstable_isNewReconciler: enableNewReconciler,
};
if (enableCache) {
  (ContextOnlyDispatcher: Dispatcher).useCacheRefresh = throwInvalidHookError;
}
if (enableUseHook) {
  (ContextOnlyDispatcher: Dispatcher).use = throwInvalidHookError;
}
if (enableUseMemoCacheHook) {
  (ContextOnlyDispatcher: Dispatcher).useMemoCache = throwInvalidHookError;
}
if (enableUseEventHook) {
  (ContextOnlyDispatcher: Dispatcher).useEvent = throwInvalidHookError;
}

const HooksDispatcherOnMount: Dispatcher = {
  readContext,

  useCallback: mountCallback,
  useContext: readContext,
  useEffect: mountEffect,
  useImperativeHandle: mountImperativeHandle,
  useLayoutEffect: mountLayoutEffect,
  useInsertionEffect: mountInsertionEffect,
  useMemo: mountMemo,
  useReducer: mountReducer,
  useRef: mountRef,
  useState: mountState,
  useDebugValue: mountDebugValue,
  useDeferredValue: mountDeferredValue,
  useTransition: mountTransition,
  useMutableSource: mountMutableSource,
  useSyncExternalStore: mountSyncExternalStore,
  useId: mountId,

  unstable_isNewReconciler: enableNewReconciler,
};
if (enableCache) {
  // $FlowFixMe[escaped-generic] discovered when updating Flow
  (HooksDispatcherOnMount: Dispatcher).useCacheRefresh = mountRefresh;
}
if (enableUseHook) {
  (HooksDispatcherOnMount: Dispatcher).use = use;
}
if (enableUseMemoCacheHook) {
  (HooksDispatcherOnMount: Dispatcher).useMemoCache = useMemoCache;
}
if (enableUseEventHook) {
  (HooksDispatcherOnMount: Dispatcher).useEvent = mountEvent;
}
const HooksDispatcherOnUpdate: Dispatcher = {
  readContext,

  useCallback: updateCallback,
  useContext: readContext,
  useEffect: updateEffect,
  useImperativeHandle: updateImperativeHandle,
  useInsertionEffect: updateInsertionEffect,
  useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useReducer: updateReducer,
  useRef: updateRef,
  useState: updateState,
  useDebugValue: updateDebugValue,
  useDeferredValue: updateDeferredValue,
  useTransition: updateTransition,
  useMutableSource: updateMutableSource,
  useSyncExternalStore: updateSyncExternalStore,
  useId: updateId,

  unstable_isNewReconciler: enableNewReconciler,
};
if (enableCache) {
  (HooksDispatcherOnUpdate: Dispatcher).useCacheRefresh = updateRefresh;
}
if (enableUseMemoCacheHook) {
  (HooksDispatcherOnUpdate: Dispatcher).useMemoCache = useMemoCache;
}
if (enableUseHook) {
  (HooksDispatcherOnUpdate: Dispatcher).use = use;
}
if (enableUseEventHook) {
  (HooksDispatcherOnUpdate: Dispatcher).useEvent = updateEvent;
}

const HooksDispatcherOnRerender: Dispatcher = {
  readContext,

  useCallback: updateCallback,
  useContext: readContext,
  useEffect: updateEffect,
  useImperativeHandle: updateImperativeHandle,
  useInsertionEffect: updateInsertionEffect,
  useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useReducer: rerenderReducer,
  useRef: updateRef,
  useState: rerenderState,
  useDebugValue: updateDebugValue,
  useDeferredValue: rerenderDeferredValue,
  useTransition: rerenderTransition,
  useMutableSource: updateMutableSource,
  useSyncExternalStore: updateSyncExternalStore,
  useId: updateId,

  unstable_isNewReconciler: enableNewReconciler,
};
if (enableCache) {
  (HooksDispatcherOnRerender: Dispatcher).useCacheRefresh = updateRefresh;
}
if (enableUseHook) {
  (HooksDispatcherOnRerender: Dispatcher).use = use;
}
if (enableUseMemoCacheHook) {
  (HooksDispatcherOnRerender: Dispatcher).useMemoCache = useMemoCache;
}
if (enableUseEventHook) {
  (HooksDispatcherOnRerender: Dispatcher).useEvent = updateEvent;
}

let HooksDispatcherOnMountInDEV: Dispatcher | null = null; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
let HooksDispatcherOnMountWithHookTypesInDEV: Dispatcher | null = null;
let HooksDispatcherOnUpdateInDEV: Dispatcher | null = null; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
let HooksDispatcherOnRerenderInDEV: Dispatcher | null = null; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++==
let InvalidNestedHooksDispatcherOnMountInDEV: Dispatcher | null = null;
let InvalidNestedHooksDispatcherOnUpdateInDEV: Dispatcher | null = null;
let InvalidNestedHooksDispatcherOnRerenderInDEV: Dispatcher | null = null;

if (__DEV__) {
  const warnInvalidContextAccess = () => {
    console.error(
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, but not ' +
        'inside Hooks like useReducer() or useMemo().',
    );
  };

  const warnInvalidHookAccess = () => {
    console.error(
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see ' +
        'https://reactjs.org/link/rules-of-hooks',
    );
  };

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  HooksDispatcherOnMountInDEV = {
    readContext<T>(context: ReactContext<T>): T {
      return readContext(context);
    },
    // OnMount期间的useCallback
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountCallback(callback, deps); // 挂载cb // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    },
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      mountHookTypesDev();
      return readContext(context);
    },
    // OnMount期间的useEffect // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountEffect(create, deps); // 挂载effect // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    },

    // OnMount期间的useImperativeHandle
    // Imperative: 至关重要的 - 迫切, 急迫, 急切
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountImperativeHandle(ref, create, deps); // 挂载 // +++++++++++++++++++++++++++++++++++++++++++++++++
    },
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountInsertionEffect(create, deps);
    },
    // // OnMount期间的useLayoutEffect
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountLayoutEffect(create, deps); // 挂载布局effect // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    },
    // OnMount期间的useMemo
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps); // 挂载memo // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    // OnMount期间的useReducer
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init); // 挂载reducer
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    // OnMount期间的useRef
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      mountHookTypesDev();
      return mountRef(initialValue); // 挂载ref // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    },
    // OnMount期间的useState // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV; // ++++++++++++++++++++++++++++++++++++++++++
      try {
        // 执行挂载状态函数
        return mountState(initialState); // +++++++++++++++++++++++++++++++++++++++++
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      mountHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    // OnMount期间的useDeferredValue
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      mountHookTypesDev();
      return mountDeferredValue(value); // 挂载推迟的值 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    },
    // OnMount期间的useTransition
    // 那么实际上这个hook就是用来进行开启【时间切片】的也就是使用renderRootConcurrent来进行去渲染的 // +++++++++++++++++++++++++++++++++++
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      mountHookTypesDev();
      return mountTransition(); // 挂载
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      mountHookTypesDev();
      return mountMutableSource(source, getSnapshot, subscribe);
    },
    // OnMount期间的useSyncExternalStore
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      mountHookTypesDev();
      // 三个参数都是函数 // +++
      /* 
      react-redux v8.0.4
      useSelector使用的是packages/use-sync-external-store/src/useSyncExternalStoreWithSelector.js这个api
      而这个api是基于这个hook的
      */
      // 内部其实就是使用了useEffect这个hook，达到在更新完毕dom之后执行订阅函数并给订阅函数传入一个参数函数【处理store变化函数，内部其实就是做一个重新渲染 - 优先级为同步车道】
      // getSnapshot函数【每次都会执行】的（不管是在挂载还是更新）
      return mountSyncExternalStore(subscribe, getSnapshot, getServerSnapshot); // 挂载同步外部储存
    },
    useId(): string {
      currentHookNameInDev = 'useId';
      mountHookTypesDev();
      return mountId();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };
  if (enableCache) {
    (HooksDispatcherOnMountInDEV: Dispatcher).useCacheRefresh = function useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      mountHookTypesDev();
      return mountRefresh();
    };
  }
  if (enableUseHook) {
    (HooksDispatcherOnMountInDEV: Dispatcher).use = use;
  }
  if (enableUseMemoCacheHook) {
    (HooksDispatcherOnMountInDEV: Dispatcher).useMemoCache = useMemoCache;
  }
  if (enableUseEventHook) {
    (HooksDispatcherOnMountInDEV: Dispatcher).useEvent = function useEvent<
      Args,
      Return,
      F: (...Array<Args>) => Return,
    >(callback: F): F {
      currentHookNameInDev = 'useEvent';
      mountHookTypesDev();
      return mountEvent(callback);
    };
  }

  HooksDispatcherOnMountWithHookTypesInDEV = {
    readContext<T>(context: ReactContext<T>): T {
      return readContext(context);
    },
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return mountCallback(callback, deps);
    },
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return mountEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return mountImperativeHandle(ref, create, deps);
    },
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      updateHookTypesDev();
      return mountInsertionEffect(create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return mountLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return mountRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return mountDeferredValue(value);
    },
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return mountTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      updateHookTypesDev();
      return mountMutableSource(source, getSnapshot, subscribe);
    },
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      updateHookTypesDev();
      return mountSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    useId(): string {
      currentHookNameInDev = 'useId';
      updateHookTypesDev();
      return mountId();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };
  if (enableCache) {
    (HooksDispatcherOnMountWithHookTypesInDEV: Dispatcher).useCacheRefresh = function useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      updateHookTypesDev();
      return mountRefresh();
    };
  }
  if (enableUseHook) {
    (HooksDispatcherOnMountWithHookTypesInDEV: Dispatcher).use = use;
  }
  if (enableUseMemoCacheHook) {
    (HooksDispatcherOnMountWithHookTypesInDEV: Dispatcher).useMemoCache = useMemoCache;
  }
  if (enableUseEventHook) {
    (HooksDispatcherOnMountWithHookTypesInDEV: Dispatcher).useEvent = function useEvent<
      Args,
      Return,
      F: (...Array<Args>) => Return,
    >(callback: F): F {
      currentHookNameInDev = 'useEvent';
      updateHookTypesDev();
      return mountEvent(callback);
    };
  }

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  HooksDispatcherOnUpdateInDEV = {
    readContext<T>(context: ReactContext<T>): T {
      return readContext(context);
    },
    // OnUpdate期间的useCallback
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return updateCallback(callback, deps); // 更新cb // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    },
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context);
    },

    // OnUpdate期间的useEffect // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    /* 
    function App() {
      useEffct
      useEffct
    }
    // App函数式组件对应的fiber的memoziedState其实就是一个hook链表
    // hook1 -> hook2
    // hook1.memoziedState -> 对应的effect1对象 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // hook2.memoziedState -> 对应的effect2对象 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // 而对于在这个fiber的updateQueue上的lastEffct属性是形成了一个关于effect的环形链表（pushEffect中做的事情啦 ~）
    // 这个lastEffect始终指向了这个effect环形链表的最后一个effect
    // effect1 -> effect2 -> effect1
    //              /\
    //              |
    //            lastEffect
    // 这样的一个关系
    // 下面就可在commitUnmount和commitMount时直接通过遍历updateQueue.lastEffect.next <- firstEffect
    // do while firstEffect.next
    // effect.destroy() - commitUnmount
    // effect.create() -> destroy -> effect.destroy - commitMount
    */
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return updateEffect(create, deps); // 更新effect +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    },
    // // OnUpdate期间的useImperativeHandle
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps); // 更新 // ++++++++++++++++++++++++++++++++++++++++++++++++++++
    },
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      updateHookTypesDev();
      return updateInsertionEffect(create, deps);
    },
    // OnUpdate期间的useLayoutEffect
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return updateLayoutEffect(create, deps); // 更新布局effect // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    },

    // OnUpdate期间的useMemo
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps); // 更新memo // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    // OnUpdate期间的useRef
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return updateRef(initialValue); // 更新ref // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    },
    // OnUpdate期间的useState // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateState(initialState); // 执行更新状态函数 // +++++++++++++++++++++++++++++++++++++++++++++++++++=
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    // OnUpdate期间的useDeferredValue
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return updateDeferredValue(value); /// 更新推迟的值 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    },
    // OnUpdate期间的useTransition
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return updateTransition(); // 更新
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    // OnUpdate期间的useSyncExternalStore
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      updateHookTypesDev();
      return updateSyncExternalStore(subscribe, getSnapshot, getServerSnapshot); // 更新同步外部存储
    },
    useId(): string {
      currentHookNameInDev = 'useId';
      updateHookTypesDev();
      return updateId();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };
  if (enableCache) {
    (HooksDispatcherOnUpdateInDEV: Dispatcher).useCacheRefresh = function useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      updateHookTypesDev();
      return updateRefresh();
    };
  }
  if (enableUseHook) {
    (HooksDispatcherOnUpdateInDEV: Dispatcher).use = use;
  }
  if (enableUseMemoCacheHook) {
    (HooksDispatcherOnUpdateInDEV: Dispatcher).useMemoCache = useMemoCache;
  }
  if (enableUseEventHook) {
    (HooksDispatcherOnUpdateInDEV: Dispatcher).useEvent = function useEvent<
      Args,
      Return,
      F: (...Array<Args>) => Return,
    >(callback: F): F {
      currentHookNameInDev = 'useEvent';
      updateHookTypesDev();
      return updateEvent(callback);
    };
  }

  HooksDispatcherOnRerenderInDEV = {
    readContext<T>(context: ReactContext<T>): T {
      return readContext(context);
    },

    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      updateHookTypesDev();
      return updateInsertionEffect(create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return rerenderReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return rerenderState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return rerenderDeferredValue(value);
    },
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return rerenderTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      updateHookTypesDev();
      return updateSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    useId(): string {
      currentHookNameInDev = 'useId';
      updateHookTypesDev();
      return updateId();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };
  if (enableCache) {
    (HooksDispatcherOnRerenderInDEV: Dispatcher).useCacheRefresh = function useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      updateHookTypesDev();
      return updateRefresh();
    };
  }
  if (enableUseHook) {
    (HooksDispatcherOnRerenderInDEV: Dispatcher).use = use;
  }
  if (enableUseMemoCacheHook) {
    (HooksDispatcherOnRerenderInDEV: Dispatcher).useMemoCache = useMemoCache;
  }
  if (enableUseEventHook) {
    (HooksDispatcherOnRerenderInDEV: Dispatcher).useEvent = function useEvent<
      Args,
      Return,
      F: (...Array<Args>) => Return,
    >(callback: F): F {
      currentHookNameInDev = 'useEvent';
      updateHookTypesDev();
      return updateEvent(callback);
    };
  }

  InvalidNestedHooksDispatcherOnMountInDEV = {
    readContext<T>(context: ReactContext<T>): T {
      warnInvalidContextAccess();
      return readContext(context);
    },
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountCallback(callback, deps);
    },
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return readContext(context);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountImperativeHandle(ref, create, deps);
    },
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountInsertionEffect(create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountDeferredValue(value);
    },
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountMutableSource(source, getSnapshot, subscribe);
    },
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    useId(): string {
      currentHookNameInDev = 'useId';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountId();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };
  if (enableCache) {
    (InvalidNestedHooksDispatcherOnMountInDEV: Dispatcher).useCacheRefresh = function useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      mountHookTypesDev();
      return mountRefresh();
    };
  }
  if (enableUseHook) {
    (InvalidNestedHooksDispatcherOnMountInDEV: Dispatcher).use = function<T>(
      usable: Usable<T>,
    ): T {
      warnInvalidHookAccess();
      return use(usable);
    };
  }
  if (enableUseMemoCacheHook) {
    (InvalidNestedHooksDispatcherOnMountInDEV: Dispatcher).useMemoCache = function(
      size: number,
    ): Array<any> {
      warnInvalidHookAccess();
      return useMemoCache(size);
    };
  }
  if (enableUseEventHook) {
    (InvalidNestedHooksDispatcherOnMountInDEV: Dispatcher).useEvent = function useEvent<
      Args,
      Return,
      F: (...Array<Args>) => Return,
    >(callback: F): F {
      currentHookNameInDev = 'useEvent';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountEvent(callback);
    };
  }

  InvalidNestedHooksDispatcherOnUpdateInDEV = {
    readContext<T>(context: ReactContext<T>): T {
      warnInvalidContextAccess();
      return readContext(context);
    },
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return readContext(context);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateInsertionEffect(create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDeferredValue(value);
    },
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    useId(): string {
      currentHookNameInDev = 'useId';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateId();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };
  if (enableCache) {
    (InvalidNestedHooksDispatcherOnUpdateInDEV: Dispatcher).useCacheRefresh = function useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      updateHookTypesDev();
      return updateRefresh();
    };
  }
  if (enableUseHook) {
    (InvalidNestedHooksDispatcherOnUpdateInDEV: Dispatcher).use = function<T>(
      usable: Usable<T>,
    ): T {
      warnInvalidHookAccess();
      return use(usable);
    };
  }
  if (enableUseMemoCacheHook) {
    (InvalidNestedHooksDispatcherOnUpdateInDEV: Dispatcher).useMemoCache = function(
      size: number,
    ): Array<any> {
      warnInvalidHookAccess();
      return useMemoCache(size);
    };
  }
  if (enableUseEventHook) {
    (InvalidNestedHooksDispatcherOnUpdateInDEV: Dispatcher).useEvent = function useEvent<
      Args,
      Return,
      F: (...Array<Args>) => Return,
    >(callback: F): F {
      currentHookNameInDev = 'useEvent';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEvent(callback);
    };
  }

  InvalidNestedHooksDispatcherOnRerenderInDEV = {
    readContext<T>(context: ReactContext<T>): T {
      warnInvalidContextAccess();
      return readContext(context);
    },

    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return readContext(context);
    },
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    useImperativeHandle<T>(
      ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateInsertionEffect(create, deps);
    },
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return rerenderReducer(reducer, initialArg, init);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useRef<T>(initialValue: T): {current: T} {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactCurrentDispatcher.current;
      ReactCurrentDispatcher.current = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return rerenderState(initialState);
      } finally {
        ReactCurrentDispatcher.current = prevDispatcher;
      }
    },
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T): T {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderDeferredValue(value);
    },
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderTransition();
    },
    useMutableSource<Source, Snapshot>(
      source: MutableSource<Source>,
      getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
      subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
    ): Snapshot {
      currentHookNameInDev = 'useMutableSource';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateMutableSource(source, getSnapshot, subscribe);
    },
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    useId(): string {
      currentHookNameInDev = 'useId';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateId();
    },

    unstable_isNewReconciler: enableNewReconciler,
  };
  if (enableCache) {
    (InvalidNestedHooksDispatcherOnRerenderInDEV: Dispatcher).useCacheRefresh = function useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      updateHookTypesDev();
      return updateRefresh();
    };
  }
  if (enableUseHook) {
    (InvalidNestedHooksDispatcherOnRerenderInDEV: Dispatcher).use = function<T>(
      usable: Usable<T>,
    ): T {
      warnInvalidHookAccess();
      return use(usable);
    };
  }
  if (enableUseMemoCacheHook) {
    (InvalidNestedHooksDispatcherOnRerenderInDEV: Dispatcher).useMemoCache = function(
      size: number,
    ): Array<any> {
      warnInvalidHookAccess();
      return useMemoCache(size);
    };
  }
  if (enableUseEventHook) {
    (InvalidNestedHooksDispatcherOnRerenderInDEV: Dispatcher).useEvent = function useEvent<
      Args,
      Return,
      F: (...Array<Args>) => Return,
    >(callback: F): F {
      currentHookNameInDev = 'useEvent';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEvent(callback);
    };
  }
}
