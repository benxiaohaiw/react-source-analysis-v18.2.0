/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  ReactProviderType,
  ReactContext,
  ReactNodeList,
  MutableSource,
} from 'shared/ReactTypes';
import type {LazyComponent as LazyComponentType} from 'react/src/ReactLazy';
import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {TypeOfMode} from './ReactTypeOfMode';
import type {Lanes, Lane} from './ReactFiberLane.new';
import type {
  SuspenseState,
  SuspenseListRenderState,
  SuspenseListTailMode,
} from './ReactFiberSuspenseComponent.new';
import type {SuspenseContext} from './ReactFiberSuspenseContext.new';
import type {
  OffscreenProps,
  OffscreenState,
  OffscreenQueue,
  OffscreenInstance,
} from './ReactFiberOffscreenComponent';
import {OffscreenDetached} from './ReactFiberOffscreenComponent';
import type {
  Cache,
  CacheComponentState,
  SpawnedCachePool,
} from './ReactFiberCacheComponent.new';
import type {UpdateQueue} from './ReactFiberClassUpdateQueue.new';
import type {RootState} from './ReactFiberRoot.new';
import type {TracingMarkerInstance} from './ReactFiberTracingMarkerComponent.new';
import checkPropTypes from 'shared/checkPropTypes';
import {
  markComponentRenderStarted,
  markComponentRenderStopped,
  setIsStrictModeForDevtools,
} from './ReactFiberDevToolsHook.new';
import {
  IndeterminateComponent,
  FunctionComponent,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostResource,
  HostSingleton,
  HostText,
  HostPortal,
  ForwardRef,
  Fragment,
  Mode,
  ContextProvider,
  ContextConsumer,
  Profiler,
  SuspenseComponent,
  SuspenseListComponent,
  MemoComponent,
  SimpleMemoComponent,
  LazyComponent,
  IncompleteClassComponent,
  ScopeComponent,
  OffscreenComponent,
  LegacyHiddenComponent,
  CacheComponent,
  TracingMarkerComponent,
} from './ReactWorkTags';
import {
  NoFlags,
  PerformedWork,
  Placement,
  Hydrating,
  ContentReset,
  DidCapture,
  Update,
  Ref,
  RefStatic,
  ChildDeletion,
  ForceUpdateForLegacySuspense,
  StaticMask,
  ShouldCapture,
  ForceClientRender,
  Passive,
} from './ReactFiberFlags';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  debugRenderPhaseSideEffectsForStrictMode,
  disableLegacyContext,
  disableModulePatternComponents,
  enableProfilerCommitHooks,
  enableProfilerTimer,
  warnAboutDefaultPropsOnFunctionComponents,
  enableScopeAPI,
  enableCache,
  enableLazyContextPropagation,
  enableSchedulingProfiler,
  enableTransitionTracing,
  enableLegacyHidden,
  enableCPUSuspense,
  enableUseMutableSource,
  enableFloat,
  enableHostSingletons,
} from 'shared/ReactFeatureFlags';
import isArray from 'shared/isArray';
import shallowEqual from 'shared/shallowEqual';
import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import getComponentNameFromType from 'shared/getComponentNameFromType';
import ReactStrictModeWarnings from './ReactStrictModeWarnings.new';
import {REACT_LAZY_TYPE, getIteratorFn} from 'shared/ReactSymbols';
import {
  getCurrentFiberOwnerNameInDevOrNull,
  setIsRendering,
} from './ReactCurrentFiber';
import {
  resolveFunctionForHotReloading,
  resolveForwardRefForHotReloading,
  resolveClassForHotReloading,
} from './ReactFiberHotReloading.new';

import {
  mountChildFibers,
  reconcileChildFibers,
  cloneChildFibers,
} from './ReactChildFiber.new';
import {
  processUpdateQueue,
  cloneUpdateQueue,
  initializeUpdateQueue,
  enqueueCapturedUpdate,
} from './ReactFiberClassUpdateQueue.new';
import {
  NoLane,
  NoLanes,
  SyncLane,
  OffscreenLane,
  DefaultHydrationLane,
  SomeRetryLane,
  NoTimestamp,
  includesSomeLane,
  laneToLanes,
  removeLanes,
  mergeLanes,
  getBumpedLaneForHydration,
  pickArbitraryLane,
} from './ReactFiberLane.new';
import {
  ConcurrentMode,
  NoMode,
  ProfileMode,
  StrictLegacyMode,
} from './ReactTypeOfMode';
import {
  shouldSetTextContent,
  isSuspenseInstancePending,
  isSuspenseInstanceFallback,
  getSuspenseInstanceFallbackErrorDetails,
  registerSuspenseInstanceRetry,
  supportsHydration,
  supportsResources,
  supportsSingletons,
  isPrimaryRenderer,
  getResource,
} from './ReactFiberHostConfig';
import type {SuspenseInstance} from './ReactFiberHostConfig';
import {shouldError, shouldSuspend} from './ReactFiberReconciler';
import {pushHostContext, pushHostContainer} from './ReactFiberHostContext.new';
import {
  suspenseStackCursor,
  pushSuspenseListContext,
  ForceSuspenseFallback,
  hasSuspenseListContext,
  setDefaultShallowSuspenseListContext,
  setShallowSuspenseListContext,
  pushPrimaryTreeSuspenseHandler,
  pushFallbackTreeSuspenseHandler,
  pushOffscreenSuspenseHandler,
  reuseSuspenseHandlerOnStack,
  popSuspenseHandler,
} from './ReactFiberSuspenseContext.new';
import {
  pushHiddenContext,
  reuseHiddenContextOnStack,
} from './ReactFiberHiddenContext.new';
import {findFirstSuspended} from './ReactFiberSuspenseComponent.new';
import {
  pushProvider,
  propagateContextChange,
  lazilyPropagateParentContextChanges,
  propagateParentContextChangesToDeferredTree,
  checkIfContextChanged,
  readContext,
  prepareToReadContext,
  scheduleContextWorkOnParentPath,
} from './ReactFiberNewContext.new';
import {
  renderWithHooks,
  checkDidRenderIdHook,
  bailoutHooks,
} from './ReactFiberHooks.new';
import {stopProfilerTimerIfRunning} from './ReactProfilerTimer.new';
import {
  getMaskedContext,
  getUnmaskedContext,
  hasContextChanged as hasLegacyContextChanged,
  pushContextProvider as pushLegacyContextProvider,
  isContextProvider as isLegacyContextProvider,
  pushTopLevelContextObject,
  invalidateContextProvider,
} from './ReactFiberContext.new';
import {
  getIsHydrating,
  enterHydrationState,
  reenterHydrationStateFromDehydratedSuspenseInstance,
  resetHydrationState,
  claimHydratableSingleton,
  tryToClaimNextHydratableInstance,
  warnIfHydrating,
  queueHydrationError,
} from './ReactFiberHydrationContext.new';
import {
  adoptClassInstance,
  constructClassInstance,
  mountClassInstance,
  resumeMountClassInstance,
  updateClassInstance,
} from './ReactFiberClassComponent.new';
import {resolveDefaultProps} from './ReactFiberLazyComponent.new';
import {
  resolveLazyComponentTag,
  createFiberFromTypeAndProps,
  createFiberFromFragment,
  createFiberFromOffscreen,
  createWorkInProgress,
  isSimpleFunctionComponent,
} from './ReactFiber.new';
import {
  retryDehydratedSuspenseBoundary,
  scheduleUpdateOnFiber,
  renderDidSuspendDelayIfPossible,
  markSkippedUpdateLanes,
  getWorkInProgressRoot,
} from './ReactFiberWorkLoop.new';
import {enqueueConcurrentRenderForLane} from './ReactFiberConcurrentUpdates.new';
import {setWorkInProgressVersion} from './ReactMutableSource.new';
import {pushCacheProvider, CacheContext} from './ReactFiberCacheComponent.new';
import {
  createCapturedValue,
  createCapturedValueAtFiber,
  type CapturedValue,
} from './ReactCapturedValue';
import {createClassErrorUpdate} from './ReactFiberThrow.new';
import is from 'shared/objectIs';
import {
  getForksAtLevel,
  isForkedChild,
  pushTreeId,
  pushMaterializedTreeId,
} from './ReactFiberTreeContext.new';
import {
  requestCacheFromPool,
  pushRootTransition,
  getSuspendedCache,
  pushTransition,
  getOffscreenDeferredCache,
  getPendingTransitions,
} from './ReactFiberTransition.new';
import {
  getMarkerInstances,
  pushMarkerInstance,
  pushRootMarkerInstance,
  TransitionTracingMarker,
} from './ReactFiberTracingMarkerComponent.new';

const ReactCurrentOwner = ReactSharedInternals.ReactCurrentOwner;

let didReceiveUpdate: boolean = false;

let didWarnAboutBadClass;
let didWarnAboutModulePatternComponent;
let didWarnAboutContextTypeOnFunctionComponent;
let didWarnAboutGetDerivedStateOnFunctionComponent;
let didWarnAboutFunctionRefs;
export let didWarnAboutReassigningProps: boolean;
let didWarnAboutRevealOrder;
let didWarnAboutTailOptions;
let didWarnAboutDefaultPropsOnFunctionComponent;

if (__DEV__) {
  didWarnAboutBadClass = {};
  didWarnAboutModulePatternComponent = {};
  didWarnAboutContextTypeOnFunctionComponent = {};
  didWarnAboutGetDerivedStateOnFunctionComponent = {};
  didWarnAboutFunctionRefs = {};
  didWarnAboutReassigningProps = false;
  didWarnAboutRevealOrder = {};
  didWarnAboutTailOptions = {};
  didWarnAboutDefaultPropsOnFunctionComponent = {};
}

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function reconcileChildren( // _+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  current: Fiber | null,
  workInProgress: Fiber,
  nextChildren: any,
  renderLanes: Lanes,
) {
  // current为null那么直接mount // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  if (current === null) { // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // If this is a fresh new component that hasn't been rendered yet, we
    // won't update its child set by applying minimal side-effects. Instead,
    // we will add them all to the child before it gets rendered. That means
    // we can optimize this reconciliation pass by not tracking side-effects.
    workInProgress.child = mountChildFibers( // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      workInProgress,
      null,
      nextChildren,
      renderLanes,
    );
  } else {
    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // If the current child is the same as the work in progress, it means that
    // we haven't yet started any work on these children. Therefore, we use
    // the clone algorithm to create a copy of all the current children.

    // If we had any progressed work already, that is invalid at this point so
    // let's throw it out.
    workInProgress.child = reconcileChildFibers( // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      workInProgress,
      current.child,
      nextChildren,
      renderLanes,
    );
  }
}

function forceUnmountCurrentAndReconcile(
  current: Fiber,
  workInProgress: Fiber,
  nextChildren: any,
  renderLanes: Lanes,
) {
  // This function is fork of reconcileChildren. It's used in cases where we
  // want to reconcile without matching against the existing set. This has the
  // effect of all current children being unmounted; even if the type and key
  // are the same, the old child is unmounted and a new child is created.
  //
  // To do this, we're going to go through the reconcile algorithm twice. In
  // the first pass, we schedule a deletion for all the current children by
  // passing null.
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    current.child,
    null,
    renderLanes,
  );
  // In the second pass, we mount the new children. The trick here is that we
  // pass null in place of where we usually pass the current child set. This has
  // the effect of remounting all children regardless of whether their
  // identities match.
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    null,
    nextChildren,
    renderLanes,
  );
}

// 更新转发ref // +++
function updateForwardRef(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
) {
  // TODO: current can be non-null here even if the component
  // hasn't yet mounted. This happens after the first render suspends.
  // We'll need to figure out if this is fine or can cause issues.

  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      const innerPropTypes = Component.propTypes;
      if (innerPropTypes) {
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentNameFromType(Component),
        );
      }
    }
  }

  const render = Component.render; // 直接就是对forwardRef函数中准备的元素类型中的render函数获取出来 // +++
  // 其实它就是一个函数式组件 // +++

  // 取出wip fiber的ref - 其实就是在forwardRef的执行结果上的组件上的ref属性
  const ref = workInProgress.ref; // 取出来 // +++
  /* 
  Counter = forwardRef(Counter)

  <Counter ref={xxx}> // 就是这个ref

  // 这种形式的 // +++
  */

  // The rest is a fork of updateFunctionComponent
  let nextChildren;
  let hasId;


  // 准备去读取上下文
  prepareToReadContext(workInProgress, renderLanes); // +++
  
  
  if (enableSchedulingProfiler) {
    markComponentRenderStarted(workInProgress);
  }
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setIsRendering(true);


    // 直接renderWithHooks函数执行
    nextChildren = renderWithHooks(
      current,
      workInProgress, // forwardRef组件对应的fiber
      render, // 它就是一个函数式组件 // +++
      nextProps,
      ref, // ref
      renderLanes,
    );
    // 内部类似于render(nextProps, ref)
    // 这种形式的 // +++

    // 返回的结果就是函数式组件返回的reatc元素


    hasId = checkDidRenderIdHook();
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictLegacyMode
    ) {
      setIsStrictModeForDevtools(true);
      try {
        nextChildren = renderWithHooks(
          current,
          workInProgress,
          render,
          nextProps,
          ref,
          renderLanes,
        );
        hasId = checkDidRenderIdHook();
      } finally {
        setIsStrictModeForDevtools(false);
      }
    }
    setIsRendering(false);
  } else {
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      render,
      nextProps,
      ref,
      renderLanes,
    );
    hasId = checkDidRenderIdHook();
  }
  if (enableSchedulingProfiler) {
    markComponentRenderStopped();
  }

  // +++
  if (current !== null && !didReceiveUpdate) {
    
    // +++
    bailoutHooks(current, workInProgress, renderLanes);

    // +++ // 尽早的返回 // +++
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  if (getIsHydrating() && hasId) {
    pushMaterializedTreeId(workInProgress);
  }


  // +++
  // React DevTools reads this flag.
  workInProgress.flags |= PerformedWork;

  // +++
  // 此时forwardRef组件对应的wip fiber的child就是react元素对应的wip fiber // +++
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);

  // +++
  return workInProgress.child; // 返回 // +++
}

// 更新memo组件 // +++
function updateMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
): null | Fiber {
  // 初次挂载
  if (current === null) {
    const type = Component.type; // 从memo函数里面准备的elementType对象中去取type也就是使用memo函数包裹的组件
    if (
      isSimpleFunctionComponent(type) && // 组件是否是简单函数式组件
      /* 
      ./ReactFiber.new.js

      // 是否为简单函数式组件 // +++
export function isSimpleFunctionComponent(type: any): boolean {
  return (
    typeof type === 'function' &&
    !shouldConstruct(type) &&
    type.defaultProps === undefined
  );
}
      */

      Component.compare === null && // memo函数也没有传递compare函数
      // SimpleMemoComponent codepath doesn't resolve outer props either.
      Component.defaultProps === undefined // true
    ) {
      let resolvedType = type; // 被包裹的组件
      if (__DEV__) {
        resolvedType = resolveFunctionForHotReloading(type);
      }
      // If this is a plain function component without default props,
      // and with only the default shallow comparison, we upgrade it
      // to a SimpleMemoComponent to allow fast path updates.

      // ++++++
      // 一定注意这个操作 // +++是很重要的 // +++
      // 这个就在beginWork中的case SimpleMemoComponent:逻辑啦 ~ // +++
      workInProgress.tag = SimpleMemoComponent; // 修改memo组件对应的fiber的tag为SimpleMemoComponent // +++ 重点（tag已经从MemoComponent改变为[SimpleMemoComponent]） // ++++++
      workInProgress.type = resolvedType; // 修改memo组件对应的fiber的type为【被包裹的组件】 // +++
      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


      if (__DEV__) {
        validateFunctionComponentInDev(workInProgress, type);
      }


      // +++
      // 更新简单memo组件 // +++
      // 其实就是memo组件对应的fiber顶替了本身原来应该是被包裹组件的fiber
      // 这里没有了被包裹组件对应的fiber了 - 而只有memo组件对应的fiber了 - 比如包裹的函数式组件返回的元素形成的child fiber是直接放在了memo组件对应的wip fiber的child上 // +++
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        resolvedType, // 被包裹的组件 // +++
        nextProps,
        renderLanes,
      );
    }

    // 假如说memo函数传入了一个比较函数 // +++
    // 那么会运行到这里的 // +++
    // 注意此时的memo组件对应的wip fiber的tag依旧还是MemoComponent - 没有被修改 // +++


    if (__DEV__) {
      const innerPropTypes = type.propTypes;
      if (innerPropTypes) {
        // Inner memo component props aren't currently validated in createElement.
        // We could move it there, but we'd still need this for lazy code path.
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentNameFromType(type),
        );
      }
    }

    // 创建了一个关于函数式组件对应的wip fiber - 注意这个fiber的tag是为IndeterminateComponent // 因为说了函数式组件的话这里创建出来的tag为IndeterminateComponent
    // 而如果是类组件的话那么这里的tag就为ClassComponent啦 ~
    const child = createFiberFromTypeAndProps(
      Component.type, // 被包裹的函数式组件
      null,
      nextProps, // pendingProps就是memo组件的props // +++ // 重点 // +++
      workInProgress,
      workInProgress.mode,
      renderLanes,
    );
    child.ref = workInProgress.ref;
    child.return = workInProgress;

    // 把memo组件对应的wip fiber的child存储这个函数式组件对应的wip fiber // +++
    workInProgress.child = child;

    // 返回这个函数式组件对应的fiber - 但他的tag为IndeterminateComponent
    return child;
  }

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // 所以说写不写比较函数影响最大的就是memo组件对应的fiber的child是谁的问题？
  // 写了则child就是函数式组件对应的fiber // +++
  // 不写则是函数式组件返回的reatc元素对应的fiber // +++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  
  // 这里是MemoComponent的更新逻辑 - 不是SimpleMemoComponent的更新的逻辑（它的tag在上面被改了之后再去更新时就不会走到这里了而是beginWork -> case SimpleMemoComponent: updateSimpleMemoComponent）

  if (__DEV__) {
    const type = Component.type;
    const innerPropTypes = type.propTypes;
    if (innerPropTypes) {
      // Inner memo component props aren't currently validated in createElement.
      // We could move it there, but we'd still need this for lazy code path.
      checkPropTypes(
        innerPropTypes,
        nextProps, // Resolved props
        'prop',
        getComponentNameFromType(type),
      );
    }
  }


  const currentChild = ((current.child: any): Fiber); // This is always exactly one child
  // 那么这个就是函数式组件对应的current fiber啦 - 它的tag已然变为了FunctionComponent啦

  // 检查是否有调度更新或上下文 // +++
  const hasScheduledUpdateOrContext = checkScheduledUpdateOrContext(
    current,
    renderLanes,
  );

  // 没有
  if (!hasScheduledUpdateOrContext) {
    // This will be the props with resolved defaultProps,
    // unlike current.memoizedProps which will be the unresolved ones.
    const prevProps = currentChild.memoizedProps; // 这个其实就是函数式组件对应的current fiber的memoizedProps
    // 也就是由上面的逻辑可知其实就是memo组件对应的上一次的属性
    
    // 默认是浅比较 // +++
    // Default to shallow comparison
    let compare = Component.compare; // 

    // shared/shallowEqual
    compare = compare !== null ? compare : shallowEqual; // 是否有compare函数，没有则采取默认的shallowEqual函数（浅比较） // +++
    // 有的话则使用用户写的比较函数 - 没有则使用默认的浅比较函数 // +++

    // 比较函数没有变化则提前返回 // +++
    if (compare(prevProps, nextProps) && current.ref === workInProgress.ref) {

      // 其实就是返回wip.child -> current.child -> .alternate -> wip.child -> 返回
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
    }
  }


  // 有的话

  // React DevTools reads this flag.
  workInProgress.flags |= PerformedWork;

  // +++
  // 新的属性
  const newChild = createWorkInProgress(currentChild, nextProps); // +++
  
  // +++
  newChild.ref = workInProgress.ref;
  newChild.return = workInProgress;
  
  workInProgress.child = newChild; // +++
  
  return newChild; // +++
}

// 更新简单memo组件 // +++
function updateSimpleMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
): null | Fiber {
  // TODO: current can be non-null here even if the component
  // hasn't yet mounted. This happens when the inner render suspends.
  // We'll need to figure out if this is fine or can cause issues.

  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      let outerMemoType = workInProgress.elementType;
      if (outerMemoType.$$typeof === REACT_LAZY_TYPE) {
        // We warn when you define propTypes on lazy()
        // so let's just skip over it to find memo() outer wrapper.
        // Inner props for memo are validated later.
        const lazyComponent: LazyComponentType<any, any> = outerMemoType;
        const payload = lazyComponent._payload;
        const init = lazyComponent._init;
        try {
          outerMemoType = init(payload);
        } catch (x) {
          // $FlowFixMe[incompatible-type] found when upgrading Flow
          outerMemoType = null;
        }
        // Inner propTypes will be validated in the function component path.
        const outerPropTypes = outerMemoType && (outerMemoType: any).propTypes;
        if (outerPropTypes) {
          checkPropTypes(
            outerPropTypes,
            nextProps, // Resolved (SimpleMemoComponent has no defaultProps)
            'prop',
            getComponentNameFromType(outerMemoType),
          );
        }
      }
    }
  }

  // 更新简单memo组件 // +++
  if (current !== null) {
    const prevProps = current.memoizedProps; // 之前传递给memo组件的属性 // +++
    if (
      
      // shared/shallowEqual
      shallowEqual(prevProps, nextProps) && // 直接使用默认浅比较函数进行比较memo组件的旧新属性是否一致 // +++
      // 只比较对象中的一层 // ++++++
      
      current.ref === workInProgress.ref &&
      // Prevent bailout if the implementation changed due to hot reload.
      (__DEV__ ? workInProgress.type === current.type : true)
    ) {
      didReceiveUpdate = false; // 标记false // +++

      // The props are shallowly equal. Reuse the previous props object, like we
      // would during a normal fiber bailout.
      //
      // We don't have strong guarantees that the props object is referentially
      // equal during updates where we can't bail out anyway — like if the props
      // are shallowly equal, but there's a local state or context update in the
      // same batch.
      //
      // However, as a principle, we should aim to make the behavior consistent
      // across different ways of memoizing a component. For example, React.memo
      // has a different internal Fiber layout if you pass a normal function
      // component (SimpleMemoComponent) versus if you pass a different type
      // like forwardRef (MemoComponent). But this is an implementation detail.
      // Wrapping a component in forwardRef (or React.lazy, etc) shouldn't
      // affect whether the props object is reused during a bailout.
      workInProgress.pendingProps = nextProps = prevProps; // +++

      if (!checkScheduledUpdateOrContext(current, renderLanes)) {
        // The pending lanes were cleared at the beginning of beginWork. We're
        // about to bail out, but there might be other lanes that weren't
        // included in the current render. Usually, the priority level of the
        // remaining updates is accumulated during the evaluation of the
        // component (i.e. when processing the update queue). But since since
        // we're bailing out early *without* evaluating the component, we need
        // to account for it here, too. Reset to the value of the current fiber.
        // NOTE: This only applies to SimpleMemoComponent, not MemoComponent,
        // because a MemoComponent fiber does not have hooks or an update queue;
        // rather, it wraps around an inner component, which may or may not
        // contains hooks.
        // TODO: Move the reset at in beginWork out of the common path so that
        // this is no longer necessary.
        workInProgress.lanes = current.lanes;
        
        // +++
        // 提前返回
        // 其实就是返回wip.child -> current.child -> .alternate -> wip.child -> 返回
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderLanes,
        );


      } else if ((current.flags & ForceUpdateForLegacySuspense) !== NoFlags) {
        // This is a special case that only exists for legacy mode.
        // See https://github.com/facebook/react/pull/19216.
        didReceiveUpdate = true;
      }
    }
  }

  // +++
  // 更新函数式组件 // +++
  return updateFunctionComponent(
    current,
    workInProgress,
    Component, // 被包裹的组件 // +++
    nextProps, // 这个是用来Component(nextProps)的 // +++
    renderLanes,
  );
}

// 更新画面以外组件 // +++
function updateOffscreenComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {

  // +++
  /* 
  在mountSuspensePrimaryChildren中准备的对象 // +++
  // 准备主要孩子属性对象 // +++
  const primaryChildProps: OffscreenProps = {
    mode: 'visible', // +++
    children: primaryChildren,
  };
  */
  const nextProps: OffscreenProps = workInProgress.pendingProps; // +++

  // 这个其实就是suspense组件的children // +++
  const nextChildren = nextProps.children; // +++

  // +++
  const prevState: OffscreenState | null =
    current !== null ? current.memoizedState : null;
  // +++

  markRef(current, workInProgress);

  if (
    nextProps.mode === 'hidden' ||
    (enableLegacyHidden &&
      nextProps.mode === 'unstable-defer-without-hiding') ||
    // TODO: remove read from stateNode.
    workInProgress.stateNode._visibility & OffscreenDetached
  ) {
    // Rendering a hidden tree.

    const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;
    if (didSuspend) {
      // Something suspended inside a hidden tree

      // Include the base lanes from the last render
      const nextBaseLanes =
        prevState !== null
          ? mergeLanes(prevState.baseLanes, renderLanes)
          : renderLanes;

      if (current !== null) {
        // Reset to the current children
        let currentChild = (workInProgress.child = current.child);

        // The current render suspended, but there may be other lanes with
        // pending work. We can't read `childLanes` from the current Offscreen
        // fiber because we reset it when it was deferred; however, we can read
        // the pending lanes from the child fibers.
        let currentChildLanes = NoLanes;
        while (currentChild !== null) {
          currentChildLanes = mergeLanes(
            mergeLanes(currentChildLanes, currentChild.lanes),
            currentChild.childLanes,
          );
          currentChild = currentChild.sibling;
        }
        const lanesWeJustAttempted = nextBaseLanes;
        const remainingChildLanes = removeLanes(
          currentChildLanes,
          lanesWeJustAttempted,
        );
        workInProgress.childLanes = remainingChildLanes;
      } else {
        workInProgress.childLanes = NoLanes;
        workInProgress.child = null;
      }

      return deferHiddenOffscreenComponent(
        current,
        workInProgress,
        nextBaseLanes,
        renderLanes,
      );
    }

    if ((workInProgress.mode & ConcurrentMode) === NoMode) {
      // In legacy sync mode, don't defer the subtree. Render it now.
      // TODO: Consider how Offscreen should work with transitions in the future
      const nextState: OffscreenState = {
        baseLanes: NoLanes,
        cachePool: null,
      };
      workInProgress.memoizedState = nextState;
      if (enableCache) {
        // push the cache pool even though we're going to bail out
        // because otherwise there'd be a context mismatch
        if (current !== null) {
          pushTransition(workInProgress, null, null);
        }
      }
      reuseHiddenContextOnStack(workInProgress);
      pushOffscreenSuspenseHandler(workInProgress);
    } else if (!includesSomeLane(renderLanes, (OffscreenLane: Lane))) {
      // We're hidden, and we're not rendering at Offscreen. We will bail out
      // and resume this tree later.

      // Schedule this fiber to re-render at Offscreen priority
      workInProgress.lanes = workInProgress.childLanes = laneToLanes(
        OffscreenLane,
      );

      // Include the base lanes from the last render
      const nextBaseLanes =
        prevState !== null
          ? mergeLanes(prevState.baseLanes, renderLanes)
          : renderLanes;

      return deferHiddenOffscreenComponent(
        current,
        workInProgress,
        nextBaseLanes,
        renderLanes,
      );
    } else {
      // This is the second render. The surrounding visible content has already
      // committed. Now we resume rendering the hidden tree.

      // Rendering at offscreen, so we can clear the base lanes.
      const nextState: OffscreenState = {
        baseLanes: NoLanes,
        cachePool: null,
      };
      workInProgress.memoizedState = nextState;
      if (enableCache && current !== null) {
        // If the render that spawned this one accessed the cache pool, resume
        // using the same cache. Unless the parent changed, since that means
        // there was a refresh.
        const prevCachePool = prevState !== null ? prevState.cachePool : null;
        // TODO: Consider if and how Offscreen pre-rendering should
        // be attributed to the transition that spawned it
        pushTransition(workInProgress, prevCachePool, null);
      }

      // Push the lanes that were skipped when we bailed out.
      if (prevState !== null) {
        pushHiddenContext(workInProgress, prevState);
      } else {
        reuseHiddenContextOnStack(workInProgress);
      }
      pushOffscreenSuspenseHandler(workInProgress);
    }
  } else {

    // +++

    // Rendering a visible tree.
    if (prevState !== null) { // ++++++
      // We're going from hidden -> visible.
      let prevCachePool = null;
      if (enableCache) {
        // If the render that spawned this one accessed the cache pool, resume
        // using the same cache. Unless the parent changed, since that means
        // there was a refresh.
        prevCachePool = prevState.cachePool;
      }

      let transitions = null;
      if (enableTransitionTracing) {
        // We have now gone from hidden to visible, so any transitions should
        // be added to the stack to get added to any Offscreen/suspense children
        const instance: OffscreenInstance | null = workInProgress.stateNode;
        if (instance !== null && instance._transitions != null) {
          transitions = Array.from(instance._transitions);
        }
      }

      pushTransition(workInProgress, prevCachePool, transitions);

      // Push the lanes that were skipped when we bailed out.
      pushHiddenContext(workInProgress, prevState);
      reuseSuspenseHandlerOnStack(workInProgress);

      // Since we're not hidden anymore, reset the state
      workInProgress.memoizedState = null; // ++++++
    } else {

      // +++

      // We weren't previously hidden, and we still aren't, so there's nothing
      // special to do. Need to push to the stack regardless, though, to avoid
      // a push/pop misalignment.

      if (enableCache) {
        // If the render that spawned this one accessed the cache pool, resume
        // using the same cache. Unless the parent changed, since that means
        // there was a refresh.
        if (current !== null) {
          pushTransition(workInProgress, null, null);
        }
      }

      // We're about to bail out, but we need to push this to the stack anyway
      // to avoid a push/pop misalignment.
      reuseHiddenContextOnStack(workInProgress);
      reuseSuspenseHandlerOnStack(workInProgress);
    }
  }

  // +++
  // +++
  reconcileChildren(current, workInProgress, nextChildren, renderLanes); // +++
  /* 
  tag为OffscreenComponent的fiber的child是一个tag为LazyComponent的fiber // +++
  */

  /* 
  // Suspense + lazy
const dynamicComponents = {
  './A': function A() {
    return (
      <div>A</div>
    )
  },
  './B': function B() {
    return (
      <div>B</div>
    )
  },
}
const load = path => new Promise(resolve => {
  setTimeout(() => {
    resolve({
      default: dynamicComponents[path]
    })
  }, 3000)
})

const A = lazy(() => load('./A'))
const B = lazy(() => load('./B'))

function App() {
  
  const [tab, setTab] = useState('A')
  
  const switchTab = () => {
    setTab(tab => tab === 'A' ? 'B' : 'A')
    // 显示加载中...组件之后B组件准备好以后再显示
    
    // startTransition(() => {
    //   setTab(tab => tab === 'A' ? 'B' : 'A')
    // }) // 暂停A组件显示 - B组件准备好以后再显示
  }
  
  return (
    <>
      <button
        onClick={switchTab}
      >
        切换
      </button>
      <Suspense
        fallback={
          <div>加载中...</div>
        }
      >
        {
          tab === 'A' ? <A/> : <B/>
        }
      </Suspense>
    </>
  )
}
  */

  // 这个例子点击按钮切换 - 进入到了这里 - reconcileChildren（还是老套路 - 报错了 // +++）

  // 返回
  return workInProgress.child;
}

function deferHiddenOffscreenComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  nextBaseLanes: Lanes,
  renderLanes: Lanes,
) {
  const nextState: OffscreenState = {
    baseLanes: nextBaseLanes,
    // Save the cache pool so we can resume later.
    cachePool: enableCache ? getOffscreenDeferredCache() : null,
  };
  workInProgress.memoizedState = nextState;
  if (enableCache) {
    // push the cache pool even though we're going to bail out
    // because otherwise there'd be a context mismatch
    if (current !== null) {
      pushTransition(workInProgress, null, null);
    }
  }

  // We're about to bail out, but we need to push this to the stack anyway
  // to avoid a push/pop misalignment.
  reuseHiddenContextOnStack(workInProgress);

  pushOffscreenSuspenseHandler(workInProgress);

  if (enableLazyContextPropagation && current !== null) {
    // Since this tree will resume rendering in a separate render, we need
    // to propagate parent contexts now so we don't lose track of which
    // ones changed.
    propagateParentContextChangesToDeferredTree(
      current,
      workInProgress,
      renderLanes,
    );
  }

  return null;
}

// Note: These happen to have identical begin phases, for now. We shouldn't hold
// ourselves to this constraint, though. If the behavior diverges, we should
// fork the function.
const updateLegacyHiddenComponent = updateOffscreenComponent;

function updateCacheComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  if (!enableCache) {
    return null;
  }

  
  // 准备去读取上下文
  prepareToReadContext(workInProgress, renderLanes); // +++
  
  
  // 读取上下文
  const parentCache = readContext(CacheContext); // +++

  if (current === null) {
    // Initial mount. Request a fresh cache from the pool.
    const freshCache = requestCacheFromPool(renderLanes);
    const initialState: CacheComponentState = {
      parent: parentCache,
      cache: freshCache,
    };
    workInProgress.memoizedState = initialState;
    initializeUpdateQueue(workInProgress);
    pushCacheProvider(workInProgress, freshCache);
  } else {
    // Check for updates
    if (includesSomeLane(current.lanes, renderLanes)) {
      cloneUpdateQueue(current, workInProgress);
      processUpdateQueue(workInProgress, null, null, renderLanes);
    }
    const prevState: CacheComponentState = current.memoizedState;
    const nextState: CacheComponentState = workInProgress.memoizedState;

    // Compare the new parent cache to the previous to see detect there was
    // a refresh.
    if (prevState.parent !== parentCache) {
      // Refresh in parent. Update the parent.
      const derivedState: CacheComponentState = {
        parent: parentCache,
        cache: parentCache,
      };

      // Copied from getDerivedStateFromProps implementation. Once the update
      // queue is empty, persist the derived state onto the base state.
      workInProgress.memoizedState = derivedState;
      if (workInProgress.lanes === NoLanes) {
        const updateQueue: UpdateQueue<any> = (workInProgress.updateQueue: any);
        workInProgress.memoizedState = updateQueue.baseState = derivedState;
      }

      pushCacheProvider(workInProgress, parentCache);
      // No need to propagate a context change because the refreshed parent
      // already did.
    } else {
      // The parent didn't refresh. Now check if this cache did.
      const nextCache = nextState.cache;
      pushCacheProvider(workInProgress, nextCache);
      if (nextCache !== prevState.cache) {
        // This cache refreshed. Propagate a context change.
        propagateContextChange(workInProgress, CacheContext, renderLanes);
      }
    }
  }

  const nextChildren = workInProgress.pendingProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// This should only be called if the name changes
function updateTracingMarkerComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  if (!enableTransitionTracing) {
    return null;
  }

  // TODO: (luna) Only update the tracing marker if it's newly rendered or it's name changed.
  // A tracing marker is only associated with the transitions that rendered
  // or updated it, so we can create a new set of transitions each time
  if (current === null) {
    const currentTransitions = getPendingTransitions();
    if (currentTransitions !== null) {
      const markerInstance: TracingMarkerInstance = {
        tag: TransitionTracingMarker,
        transitions: new Set(currentTransitions),
        pendingBoundaries: null,
        name: workInProgress.pendingProps.name,
        aborts: null,
      };
      workInProgress.stateNode = markerInstance;

      // We call the marker complete callback when all child suspense boundaries resolve.
      // We do this in the commit phase on Offscreen. If the marker has no child suspense
      // boundaries, we need to schedule a passive effect to make sure we call the marker
      // complete callback.
      workInProgress.flags |= Passive;
    }
  } else {
    if (__DEV__) {
      if (current.memoizedProps.name !== workInProgress.pendingProps.name) {
        console.error(
          'Changing the name of a tracing marker after mount is not supported. ' +
            'To remount the tracing marker, pass it a new key.',
        );
      }
    }
  }

  const instance: TracingMarkerInstance | null = workInProgress.stateNode;
  if (instance !== null) {
    pushMarkerInstance(workInProgress, instance);
  }
  const nextChildren = workInProgress.pendingProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// 更新fragment // +++
function updateFragment(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  
  const nextChildren = workInProgress.pendingProps; // 直接取出wip的pendingProps，其实它就是fragment的children // +++

  reconcileChildren(current, workInProgress, nextChildren, renderLanes); // 这里直接就进行了reconcileChildren

  return workInProgress.child; // 直接返回wip的child // +++
}

function updateMode(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextChildren = workInProgress.pendingProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

function updateProfiler(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  if (enableProfilerTimer) {
    workInProgress.flags |= Update;

    if (enableProfilerCommitHooks) {
      // Reset effect durations for the next eventual effect phase.
      // These are reset during render to allow the DevTools commit hook a chance to read them,
      const stateNode = workInProgress.stateNode;
      stateNode.effectDuration = 0;
      stateNode.passiveEffectDuration = 0;
    }
  }
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// 标记ref // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function markRef(current: Fiber | null, workInProgress: Fiber) {
  const ref = workInProgress.ref;
  if (
    (current === null && ref !== null) ||
    (current !== null && current.ref !== ref)
  ) {
    // Schedule a Ref effect
    workInProgress.flags |= Ref;
    workInProgress.flags |= RefStatic;
  }
}

// 更新函数式组件 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateFunctionComponent( // 更新函数式组件
  current,
  workInProgress,
  Component,
  nextProps: any,
  renderLanes,
) {
  if (__DEV__) {
    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      const innerPropTypes = Component.propTypes;
      if (innerPropTypes) {
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentNameFromType(Component),
        );
      }
    }
  }

  let context;
  if (!disableLegacyContext) {
    const unmaskedContext = getUnmaskedContext(workInProgress, Component, true);
    context = getMaskedContext(workInProgress, unmaskedContext);
  }

  let nextChildren;
  let hasId;

  // 准备去读取上下文
  prepareToReadContext(workInProgress, renderLanes); // +++
  
  
  if (enableSchedulingProfiler) {
    markComponentRenderStarted(workInProgress);
  }
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setIsRendering(true);
    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // 返回新的孩子（一个新的vnode树）
    nextChildren = renderWithHooks( // 还是执行renderWithHooks函数 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      current,
      workInProgress,
      Component, // 组件 // +++
      nextProps, // +++
      context,
      renderLanes,
      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    ); // 注意：在renderWithHooks -> Component -> useState -> updateState -> updateReducer -> !is(newState, hook.memoizedState): markWorkInProgressReceivedUpdate -> 
    // didReceiveUpdate: true
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    hasId = checkDidRenderIdHook();
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictLegacyMode
    ) {
      setIsStrictModeForDevtools(true);
      try {
        nextChildren = renderWithHooks(
          current,
          workInProgress,
          Component,
          nextProps,
          context,
          renderLanes,
        );
        hasId = checkDidRenderIdHook();
      } finally {
        setIsStrictModeForDevtools(false);
      }
    }
    setIsRendering(false);
  } else {
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      Component,
      nextProps,
      context,
      renderLanes,
    );
    hasId = checkDidRenderIdHook();
  }
  if (enableSchedulingProfiler) {
    markComponentRenderStopped();
  }

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  if (current !== null && !didReceiveUpdate) { // 这个如果为true则【直接说明了state是没有变化的】，那么直接不要进行下面的reconcileChildren操作了
    /* 
    // 标记wip已接受更新 +++
export function markWorkInProgressReceivedUpdate() {
  didReceiveUpdate = true; // +++
}
    */

    // 而是直接抄近道，照着下面的逻辑进行执行运行 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    bailoutHooks(current, workInProgress, renderLanes);
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes); // +++++++++++++++++++++++
    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // 这个函数简单的来讲就是检查wip的childLanes是否包含renderLanes
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // 包含的话就直接让wip的child指向current的child的alternate（packages/react-reconciler/src/ReactChildFiber.new.js中的cloneChildFibers） // ++++++++++++++++++++++++++
    // 如果不包含的话那么直接返回的是一个null
    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }

  if (getIsHydrating() && hasId) {
    pushMaterializedTreeId(workInProgress);
  }

  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // react devTools会读取这个标记 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // React DevTools reads this flag.
  workInProgress.flags |= PerformedWork; // 1 // App函数式组件的对应的当前的fiber的flags就会 |= PerformedWork: 1 // +++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 进行fiber间的diff // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  reconcileChildren(current, workInProgress, nextChildren, renderLanes); // ++++++++++++++++++++++++++++++++++++++++++++++++
  return workInProgress.child;
}


// 更新类组件 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateClassComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
) {
  if (__DEV__) {
    // This is used by DevTools to force a boundary to error.
    switch (shouldError(workInProgress)) {
      case false: {
        const instance = workInProgress.stateNode;
        const ctor = workInProgress.type;
        // TODO This way of resetting the error boundary state is a hack.
        // Is there a better way to do this?
        const tempInstance = new ctor(
          workInProgress.memoizedProps,
          instance.context,
        );
        const state = tempInstance.state;
        instance.updater.enqueueSetState(instance, state, null);
        break;
      }
      case true: {
        workInProgress.flags |= DidCapture;
        workInProgress.flags |= ShouldCapture;
        // eslint-disable-next-line react-internal/prod-error-codes
        const error = new Error('Simulated error coming from DevTools');
        const lane = pickArbitraryLane(renderLanes);
        workInProgress.lanes = mergeLanes(workInProgress.lanes, lane);
        // Schedule the error boundary to re-render using updated state
        const update = createClassErrorUpdate(
          workInProgress,
          createCapturedValueAtFiber(error, workInProgress),
          lane,
        );
        enqueueCapturedUpdate(workInProgress, update);
        break;
      }
    }

    if (workInProgress.type !== workInProgress.elementType) {
      // Lazy component props can't be validated in createElement
      // because they're only guaranteed to be resolved here.
      const innerPropTypes = Component.propTypes;
      if (innerPropTypes) {
        checkPropTypes(
          innerPropTypes,
          nextProps, // Resolved props
          'prop',
          getComponentNameFromType(Component),
        );
      }
    }
  }

  // Push context providers early to prevent context stack mismatches.
  // During mounting we don't know the child context yet as the instance doesn't exist.
  // We will invalidate the child context in finishClassComponent() right after rendering.
  let hasContext;
  if (isLegacyContextProvider(Component)) {
    hasContext = true;
    pushLegacyContextProvider(workInProgress);
  } else {
    hasContext = false;
  }

  
  // 准备去读取上下文
  prepareToReadContext(workInProgress, renderLanes); // +++


  const instance = workInProgress.stateNode; // 实例对象 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  let shouldUpdate;
  if (instance === null) { // mount时 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    resetSuspendedCurrentOnMountInLegacyMode(current, workInProgress);

    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // 在初始阶段，我们可能需要构造实例。
    // In the initial pass we might need to construct the instance.
    // ./ReactFiberClassComponent.new.js // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    constructClassInstance(workInProgress, Component, nextProps); // 构造类实例 // +++++++++++++++++++++++++++++++++++++++++++++++++++++
    mountClassInstance(workInProgress, Component, nextProps, renderLanes); // 挂载类实例 // ++++++++++++++++++++++++++++++++++++++++++++
    // mountClassInstance -> initializeUpdateQueue // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    // +++
    // mount时肯定是需要进行更新的 // +++

    shouldUpdate = true; // 标记应该更新 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  } else if (current === null) {
    // In a resume, we'll already have an instance we can reuse.
    shouldUpdate = resumeMountClassInstance( // 恢复挂载类实例 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      workInProgress,
      Component,
      nextProps,
      renderLanes,
    );
  } else { // 更新 // +++
    // 更新类实例 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // ./ReactFiberClassComponent.new.js
    shouldUpdate = updateClassInstance( // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      current,
      workInProgress,
      Component,
      nextProps,
      renderLanes,
    ); // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 完成类组件 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // 返回下一个工作单元
  const nextUnitOfWork = finishClassComponent(
    current,
    workInProgress,
    Component,
    shouldUpdate,
    hasContext,
    renderLanes,
  );
  if (__DEV__) {
    const inst = workInProgress.stateNode;
    if (shouldUpdate && inst.props !== nextProps) {
      if (!didWarnAboutReassigningProps) {
        console.error(
          'It looks like %s is reassigning its own `this.props` while rendering. ' +
            'This is not supported and can lead to confusing bugs.',
          getComponentNameFromFiber(workInProgress) || 'a component',
        );
      }
      didWarnAboutReassigningProps = true;
    }
  }

  // 返回下一个工作单元 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return nextUnitOfWork;
}


// 完成类组件 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function finishClassComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  shouldUpdate: boolean,
  hasContext: boolean,
  renderLanes: Lanes,
) {


  // 即使 shouldComponentUpdate 返回 false，Refs也应该更新
  // Refs should update even if shouldComponentUpdate returns false
  markRef(current, workInProgress); // 标记ref // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  const didCaptureError = (workInProgress.flags & DidCapture) !== NoFlags;

  if (!shouldUpdate && !didCaptureError) {
    // Context providers should defer to sCU for rendering
    if (hasContext) {
      invalidateContextProvider(workInProgress, Component, false);
    }

    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  const instance = workInProgress.stateNode; // 类组件实例 // ++++++++++++++++++++++++++++++++++++++++++++++++

  // Rerender
  ReactCurrentOwner.current = workInProgress;
  let nextChildren;
  if (
    didCaptureError &&
    typeof Component.getDerivedStateFromError !== 'function'
  ) {
    // If we captured an error, but getDerivedStateFromError is not defined,
    // unmount all the children. componentDidCatch will schedule an update to
    // re-render a fallback. This is temporary until we migrate everyone to
    // the new API.
    // TODO: Warn in a future release.
    nextChildren = null;

    if (enableProfilerTimer) {
      stopProfilerTimerIfRunning(workInProgress);
    }
  } else {
    if (enableSchedulingProfiler) {
      markComponentRenderStarted(workInProgress);
    }
    if (__DEV__) {
      setIsRendering(true);


      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      nextChildren = instance.render(); // 直接执行实例的render函数，返回vnode // ++++++++++++++++++++++++++++++++++++++++
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      
      if (
        debugRenderPhaseSideEffectsForStrictMode &&
        workInProgress.mode & StrictLegacyMode
      ) {
        setIsStrictModeForDevtools(true);
        try {
          instance.render();
        } finally {
          setIsStrictModeForDevtools(false);
        }
      }
      setIsRendering(false);
    } else {
      nextChildren = instance.render();
    }
    if (enableSchedulingProfiler) {
      markComponentRenderStopped();
    }
  }

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // React DevTools reads this flag.
  workInProgress.flags |= PerformedWork; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


  if (current !== null && didCaptureError) {
    // If we're recovering from an error, reconcile without reusing any of
    // the existing children. Conceptually, the normal children and the children
    // that are shown on error are two different sets, so we shouldn't reuse
    // normal children even if their identities match.
    forceUnmountCurrentAndReconcile(
      current,
      workInProgress,
      nextChildren,
      renderLanes,
    );
  } else {

    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    reconcileChildren(current, workInProgress, nextChildren, renderLanes); // +++++++++++++++++++++++++++++++++
    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
  }

  // Memoize state using the values we just used to render.
  // TODO: Restructure so we never read values from the instance.
  workInProgress.memoizedState = instance.state; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // The context might have changed so we need to recalculate it.
  if (hasContext) {
    invalidateContextProvider(workInProgress, Component, true);
  }

  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return workInProgress.child; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

function pushHostRootContext(workInProgress) {
  const root = (workInProgress.stateNode: FiberRoot);
  if (root.pendingContext) {
    pushTopLevelContextObject(
      workInProgress,
      root.pendingContext,
      root.pendingContext !== root.context,
    );
  } else if (root.context) {
    // Should always be set
    pushTopLevelContextObject(workInProgress, root.context, false);
  }
  pushHostContainer(workInProgress, root.containerInfo);
}

// 更新主机root // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateHostRoot(current, workInProgress, renderLanes) {
  pushHostRootContext(workInProgress);

  if (current === null) {
    throw new Error('Should have a current fiber. This is a bug in React.');
  }

  const nextProps = workInProgress.pendingProps; // 要更新的属性
  const prevState = workInProgress.memoizedState; // 上一次的状态 // {}
  const prevChildren = prevState.element; // 上一次的元素 // undefined // ++++++++++++++++++++++++++++++++++++++++++++++
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ./ReactFiberClassUpdateQueue.new.js
  cloneUpdateQueue(current, workInProgress); // 克隆更新队列
  // 就是把current的updateQueue克隆到wip的updateQueue上，注意这是一个【浅克隆】 // ++++++++++++++++++++++++++++++++++++++

  processUpdateQueue(workInProgress, nextProps, null, renderLanes); // 处理更新队列
  // 主要就是处理wip的updateQueue的
  // 1.把wip.updateQueue.shared.pending = null
  // 2.把{element}对象放置在wip的updateQueue.baseState上的
  // 3.把{element}对象放置在wip的memoizedState上 // +++++++++++++++++++++++++++++++++++++++++++++++++++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  const nextState: RootState = workInProgress.memoizedState; // 要更新的状态 // {element};
  const root: FiberRoot = workInProgress.stateNode; // FiberRootNode
  pushRootTransition(workInProgress, root, renderLanes);

  if (enableTransitionTracing) {
    pushRootMarkerInstance(workInProgress);
  }

  if (enableCache) {
    const nextCache: Cache = nextState.cache;
    pushCacheProvider(workInProgress, nextCache);
    if (nextCache !== prevState.cache) {
      // The root cache refreshed.
      propagateContextChange(workInProgress, CacheContext, renderLanes);
    }
  }

  // Caution: React DevTools currently depends on this property
  // being called "element".
  const nextChildren = nextState.element; // 现在的App

  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  if (supportsHydration && prevState.isDehydrated) { // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // This is a hydration root whose shell has not yet hydrated. We should
    // attempt to hydrate.

    // Flip isDehydrated to false to indicate that when this render
    // finishes, the root will no longer be dehydrated.
    const overrideState: RootState = {
      element: nextChildren,
      isDehydrated: false,
      cache: nextState.cache,
    };
    const updateQueue: UpdateQueue<RootState> = (workInProgress.updateQueue: any);
    // `baseState` can always be the last state because the root doesn't
    // have reducer functions so it doesn't need rebasing.
    updateQueue.baseState = overrideState;
    workInProgress.memoizedState = overrideState;

    if (workInProgress.flags & ForceClientRender) {
      // Something errored during a previous attempt to hydrate the shell, so we
      // forced a client render.
      const recoverableError = createCapturedValueAtFiber(
        new Error(
          'There was an error while hydrating. Because the error happened outside ' +
            'of a Suspense boundary, the entire root will switch to ' +
            'client rendering.',
        ),
        workInProgress,
      );
      return mountHostRootWithoutHydrating(
        current,
        workInProgress,
        nextChildren,
        renderLanes,
        recoverableError,
      );
    } else if (nextChildren !== prevChildren) {
      const recoverableError = createCapturedValueAtFiber(
        new Error(
          'This root received an early update, before anything was able ' +
            'hydrate. Switched the entire root to client rendering.',
        ),
        workInProgress,
      );
      return mountHostRootWithoutHydrating(
        current,
        workInProgress,
        nextChildren,
        renderLanes,
        recoverableError,
      );
    } else {
      // The outermost shell has not hydrated yet. Start hydrating.
      enterHydrationState(workInProgress);
      if (enableUseMutableSource) {
        const mutableSourceEagerHydrationData =
          root.mutableSourceEagerHydrationData;
        if (mutableSourceEagerHydrationData != null) {
          for (let i = 0; i < mutableSourceEagerHydrationData.length; i += 2) {
            const mutableSource = ((mutableSourceEagerHydrationData[
              i
            ]: any): MutableSource<any>);
            const version = mutableSourceEagerHydrationData[i + 1];
            setWorkInProgressVersion(mutableSource, version);
          }
        }
      }

      const child = mountChildFibers(
        workInProgress,
        null,
        nextChildren,
        renderLanes,
      );
      workInProgress.child = child;

      let node = child;
      while (node) {
        // Mark each child as hydrating. This is a fast path to know whether this
        // tree is part of a hydrating tree. This is used to determine if a child
        // node has fully mounted yet, and for scheduling event replaying.
        // Conceptually this is similar to Placement in that a new subtree is
        // inserted into the React tree here. It just happens to not need DOM
        // mutations because it already exists.
        node.flags = (node.flags & ~Placement) | Hydrating;
        node = node.sibling;
      }
    }
  } else { // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // root是没有混合的。这要么是只客户端root，要么是以及混合了 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // Root is not dehydrated. Either this is a client-only root, or it
    // already hydrated.
    resetHydrationState();
    if (nextChildren === prevChildren) {
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
    }
    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=++++++++++++++++++++++++++++
    reconcileChildren(current, workInProgress, nextChildren, renderLanes); // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++这里很重要
  }


  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // 注意：如果App是类组件的话，那么这里的fiber它的tag就是为ClassComponent
  // 而如果是函数式组件的话，它的tag在这里暂时为IndeterminateComponent
  // 要注意的！！！
  return workInProgress.child; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

function mountHostRootWithoutHydrating(
  current: Fiber,
  workInProgress: Fiber,
  nextChildren: ReactNodeList,
  renderLanes: Lanes,
  recoverableError: CapturedValue<mixed>,
) {
  // Revert to client rendering.
  resetHydrationState();

  queueHydrationError(recoverableError);

  workInProgress.flags |= ForceClientRender;

  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// 更新主机组件 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateHostComponent( // button
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  pushHostContext(workInProgress);

  if (current === null) {
    tryToClaimNextHydratableInstance(workInProgress);
  }

  const type = workInProgress.type; // 类型
  const nextProps = workInProgress.pendingProps; // 待处理的属性 - 其实就是vnode的props // ++++++++++++++++++++++++++++++++++++++
  const prevProps = current !== null ? current.memoizedProps : null; //current的上一次的属性

  let nextChildren = nextProps.children; // 待处理属性中的children
  const isDirectTextChild = shouldSetTextContent(type, nextProps);
  // 是否为直接文本孩子
  
  /* 
  packages/react-dom-bindings/src/client/ReactDOMHostConfig.js
  export function shouldSetTextContent(type: string, props: Props): boolean {
    return (
      type === 'textarea' ||
      type === 'noscript' ||
      typeof props.children === 'string' ||
      typeof props.children === 'number' ||
      (typeof props.dangerouslySetInnerHTML === 'object' &&
        props.dangerouslySetInnerHTML !== null &&
        props.dangerouslySetInnerHTML.__html != null)
    );
  }
  */

  if (isDirectTextChild) { // 是直接文本孩子 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // We special case a direct text child of a host node. This is a common
    // case. We won't handle it as a reified child. We will instead handle
    // this in the host environment that also has access to this prop. That
    // avoids allocating another HostText fiber and traversing it.
    nextChildren = null;
  } else if (prevProps !== null && shouldSetTextContent(type, prevProps)) { // 之前属性不为null 且 之前是直接文本孩子
    // If we're switching from a direct text child to a normal child, or to
    // empty, we need to schedule the text content to be reset.
    workInProgress.flags |= ContentReset; // 标记ContentReset // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }

  // 标记ref // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  markRef(current, workInProgress); // 给wip fiber的flags加上Ref和RefStatic标记 // +++++++++++++++++++++++++++++++++++++++++++++++++++
  /* 
  function markRef(current: Fiber | null, workInProgress: Fiber) {
  const ref = workInProgress.ref;
  if (
    (current === null && ref !== null) ||
    (current !== null && current.ref !== ref)
  ) {
    // Schedule a Ref effect
    workInProgress.flags |= Ref;
    workInProgress.flags |= RefStatic;
  }
}
  */


  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  reconcileChildren(current, workInProgress, nextChildren, renderLanes); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return workInProgress.child;
}

function updateHostResource(current, workInProgress, renderLanes) {
  pushHostContext(workInProgress);
  markRef(current, workInProgress);
  const currentProps = current === null ? null : current.memoizedProps;
  workInProgress.memoizedState = getResource(
    workInProgress.type,
    workInProgress.pendingProps,
    currentProps,
  );
  // Resources never have reconciler managed children. It is possible for
  // the host implementation of getResource to consider children in the
  // resource construction but they will otherwise be discarded. In practice
  // this precludes all but the simplest children and Host specific warnings
  // should be implemented to warn when children are passsed when otherwise not
  // expected
  return null;
}

function updateHostSingleton(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  pushHostContext(workInProgress);

  if (current === null) {
    claimHydratableSingleton(workInProgress);
  }

  const nextChildren = workInProgress.pendingProps.children;

  if (current === null && !getIsHydrating()) {
    // Similar to Portals we append Singleton children in the commit phase. So we
    // Track insertions even on mount.
    // TODO: Consider unifying this with how the root works.
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderLanes,
    );
  } else {
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  }
  markRef(current, workInProgress);
  return workInProgress.child;
}

// 更新主机文本 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function updateHostText(current, workInProgress) {
  if (current === null) {
    tryToClaimNextHydratableInstance(workInProgress);
  }
  // ++++++++++++++++++++++++++++
  // 这里没什么可做的。这是【终端】。我们将在之后立即执行完成步骤。 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // Nothing to do here. This is terminal. We'll do the completion step
  // immediately after.
  return null; // 返回null // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

// 挂载懒组件 // +++
function mountLazyComponent(
  _current,
  workInProgress,
  elementType,
  renderLanes,
) {
  resetSuspendedCurrentOnMountInLegacyMode(_current, workInProgress);

  const props = workInProgress.pendingProps;
  const lazyComponent: LazyComponentType<any, any> = elementType;
  /* 
  就是packages/react/src/ReactLazy.js中lazy函数中的
  // +++
  const lazyType: LazyComponent<T, Payload<T>> = {
    $$typeof: REACT_LAZY_TYPE, // +++
    _payload: payload, /// payload对象
    _init: lazyInitializer, // 懒初始化器函数 // +++
  };
  */

  const payload = lazyComponent._payload;
  const init = lazyComponent._init;


  let Component = init(payload); // 第一次走到这里将throw lazy函数参数函数执行返回的结果应是一个promise
  // 那么这个错误将抛出到packages/react-reconciler/src/ReactFiberWorkLoop.new.js中的beginWork -> renderRootSync中的catch中的handleThrow函数中进行处理的 // +++
  // +++

  // 之后的执行就变为了函数式组件 - 就是一个函数 // +++
  
  
  // Store the unwrapped component in the type.
  workInProgress.type = Component; // 直接【变更】wip的type为当前的组件 // +++


  // 解析懒组件标签 // +++
  const resolvedTag = (workInProgress.tag = resolveLazyComponentTag(Component)); // +++ 【变更】当前wip的tag
  // FunctionComponent | ClassComponent | ForwardRef | MemoComponent


  // 解析默认属性
  const resolvedProps = resolveDefaultProps(Component, props);
  // 实际就是到Component.defaultProps上的属性合并到props对象上的 // +++


  let child;
  switch (resolvedTag) {

    // 函数式组件 // +++
    case FunctionComponent: {
      if (__DEV__) {
        validateFunctionComponentInDev(workInProgress, Component);
        workInProgress.type = Component = resolveFunctionForHotReloading(
          Component,
        );
      }
      
      // 注意到这里wip的type变为了函数 - tag也变为了FunctionComponent了 // +++

      // 直接按照更新函数式组件的逻辑进行处理这个wip // +++
      child = updateFunctionComponent(
        null, // current为null // +++ // 要注意！！！
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );

      // +++
      // 返回这个child了 // +++ // 那么它就是函数式组件返回的react元素对应的fiber啦 ~
      return child; // +++
    }
    case ClassComponent: {
      if (__DEV__) {
        workInProgress.type = Component = resolveClassForHotReloading(
          Component,
        );
      }
      child = updateClassComponent(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
      return child;
    }
    case ForwardRef: {
      if (__DEV__) {
        workInProgress.type = Component = resolveForwardRefForHotReloading(
          Component,
        );
      }
      child = updateForwardRef(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
      return child;
    }
    case MemoComponent: {
      if (__DEV__) {
        if (workInProgress.type !== workInProgress.elementType) {
          const outerPropTypes = Component.propTypes;
          if (outerPropTypes) {
            checkPropTypes(
              outerPropTypes,
              resolvedProps, // Resolved for outer only
              'prop',
              getComponentNameFromType(Component),
            );
          }
        }
      }
      child = updateMemoComponent(
        null,
        workInProgress,
        Component,
        resolveDefaultProps(Component.type, resolvedProps), // The inner type can have defaults too
        renderLanes,
      );
      return child;
    }
  }
  let hint = '';
  if (__DEV__) {
    if (
      Component !== null &&
      typeof Component === 'object' &&
      Component.$$typeof === REACT_LAZY_TYPE
    ) {
      hint = ' Did you wrap a component in React.lazy() more than once?';
    }
  }

  // This message intentionally doesn't mention ForwardRef or MemoComponent
  // because the fact that it's a separate type of work is an
  // implementation detail.
  throw new Error(
    `Element type is invalid. Received a promise that resolves to: ${Component}. ` +
      `Lazy element type must resolve to a class or function.${hint}`,
  );
}

function mountIncompleteClassComponent(
  _current,
  workInProgress,
  Component,
  nextProps,
  renderLanes,
) {
  resetSuspendedCurrentOnMountInLegacyMode(_current, workInProgress);

  // Promote the fiber to a class and try rendering again.
  workInProgress.tag = ClassComponent;

  // The rest of this function is a fork of `updateClassComponent`

  // Push context providers early to prevent context stack mismatches.
  // During mounting we don't know the child context yet as the instance doesn't exist.
  // We will invalidate the child context in finishClassComponent() right after rendering.
  let hasContext;
  if (isLegacyContextProvider(Component)) {
    hasContext = true;
    pushLegacyContextProvider(workInProgress);
  } else {
    hasContext = false;
  }

  
  // 准备去读取上下文
  prepareToReadContext(workInProgress, renderLanes); // +++


  constructClassInstance(workInProgress, Component, nextProps);
  mountClassInstance(workInProgress, Component, nextProps, renderLanes);

  return finishClassComponent(
    null,
    workInProgress,
    Component,
    true,
    hasContext,
    renderLanes,
  );
}

// 挂载不确定的组件 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function mountIndeterminateComponent(
  _current,
  workInProgress,
  Component,
  renderLanes,
) {
  resetSuspendedCurrentOnMountInLegacyMode(_current, workInProgress);

  const props = workInProgress.pendingProps;
  let context;
  if (!disableLegacyContext) {
    const unmaskedContext = getUnmaskedContext(
      workInProgress,
      Component,
      false,
    );
    context = getMaskedContext(workInProgress, unmaskedContext);
  }

  
  // 准备去读取上下文 // +++
  prepareToReadContext(workInProgress, renderLanes); // +++
  // packages/react-reconciler/src/ReactFiberNewContext.new.js下的currentlyRenderingFiber记住这个wip
  // 然后把lastContextDependency、lastFullyObservedContext等变量置为null
  // 对于Counter函数式组件来讲在一开始挂载不确定组件里面在这里主要是这个逻辑 // +++
  // 下面再进行确定是否为函数式组件的 // +++
  
  
  let value;
  let hasId;

  if (enableSchedulingProfiler) {
    markComponentRenderStarted(workInProgress);
  }
  if (__DEV__) {
    if (
      Component.prototype &&
      typeof Component.prototype.render === 'function'
    ) {
      const componentName = getComponentNameFromType(Component) || 'Unknown';

      if (!didWarnAboutBadClass[componentName]) {
        console.error(
          "The <%s /> component appears to have a render method, but doesn't extend React.Component. " +
            'This is likely to cause errors. Change %s to extend React.Component instead.',
          componentName,
          componentName,
        );
        didWarnAboutBadClass[componentName] = true;
      }
    }

    if (workInProgress.mode & StrictLegacyMode) {
      ReactStrictModeWarnings.recordLegacyContextWarning(workInProgress, null);
    }

    setIsRendering(true);
    ReactCurrentOwner.current = workInProgress;
    
    
    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // react-reconciler/src/ReactFiberHooks.new.js中的renderWithHooks函数
    value = renderWithHooks( // 带有hooks的渲染 - 产生虚拟dom元素 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      null,
      workInProgress,
      Component,
      props,
      context,
      renderLanes,
    ); // +++

    
    hasId = checkDidRenderIdHook();
    setIsRendering(false);
  } else {

    // +++
    value = renderWithHooks( // 带有hooks的渲染 - 产生虚拟dom元素
      null,
      workInProgress,
      Component,
      props,
      context,
      renderLanes,
    );

    hasId = checkDidRenderIdHook();
  }
  if (enableSchedulingProfiler) {
    markComponentRenderStopped();
  }

  // React DevTools读取这个标记
  // React DevTools reads this flag.
  workInProgress.flags |= PerformedWork; // 加上这个PerformedWork标记

  if (__DEV__) {
    // Support for module components is deprecated and is removed behind a flag.
    // Whether or not it would crash later, we want to show a good message in DEV first.
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof value.render === 'function' &&
      value.$$typeof === undefined
    ) {
      const componentName = getComponentNameFromType(Component) || 'Unknown';
      if (!didWarnAboutModulePatternComponent[componentName]) {
        console.error(
          'The <%s /> component appears to be a function component that returns a class instance. ' +
            'Change %s to a class that extends React.Component instead. ' +
            "If you can't use a class try assigning the prototype on the function as a workaround. " +
            "`%s.prototype = React.Component.prototype`. Don't use an arrow function since it " +
            'cannot be called with `new` by React.',
          componentName,
          componentName,
          componentName,
        );
        didWarnAboutModulePatternComponent[componentName] = true;
      }
    }
  }

  if (
    // Run these checks in production only if the flag is off.
    // Eventually we'll delete this branch altogether.
    !disableModulePatternComponents &&
    typeof value === 'object' &&
    value !== null &&
    typeof value.render === 'function' &&
    value.$$typeof === undefined
  ) {
    if (__DEV__) {
      const componentName = getComponentNameFromType(Component) || 'Unknown';
      if (!didWarnAboutModulePatternComponent[componentName]) {
        console.error(
          'The <%s /> component appears to be a function component that returns a class instance. ' +
            'Change %s to a class that extends React.Component instead. ' +
            "If you can't use a class try assigning the prototype on the function as a workaround. " +
            "`%s.prototype = React.Component.prototype`. Don't use an arrow function since it " +
            'cannot be called with `new` by React.',
          componentName,
          componentName,
          componentName,
        );
        didWarnAboutModulePatternComponent[componentName] = true;
      }
    }

    // Proceed under the assumption that this is a class instance
    workInProgress.tag = ClassComponent;

    // Throw out any hooks that were used.
    workInProgress.memoizedState = null;
    workInProgress.updateQueue = null;

    // Push context providers early to prevent context stack mismatches.
    // During mounting we don't know the child context yet as the instance doesn't exist.
    // We will invalidate the child context in finishClassComponent() right after rendering.
    let hasContext = false;
    if (isLegacyContextProvider(Component)) {
      hasContext = true;
      pushLegacyContextProvider(workInProgress);
    } else {
      hasContext = false;
    }

    workInProgress.memoizedState =
      value.state !== null && value.state !== undefined ? value.state : null;

    initializeUpdateQueue(workInProgress);

    adoptClassInstance(workInProgress, value);
    mountClassInstance(workInProgress, Component, props, renderLanes);
    return finishClassComponent(
      null,
      workInProgress,
      Component,
      true,
      hasContext,
      renderLanes,
    );
  } else {


    // 在假设这是一个函数式组件下处理 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // Proceed under the assumption that this is a function component
    workInProgress.tag = FunctionComponent; // 给它的tag改为函数式组件标签 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    if (__DEV__) {
      if (disableLegacyContext && Component.contextTypes) {
        console.error(
          '%s uses the legacy contextTypes API which is no longer supported. ' +
            'Use React.createContext() with React.useContext() instead.',
          getComponentNameFromType(Component) || 'Unknown',
        );
      }

      if (
        debugRenderPhaseSideEffectsForStrictMode &&
        workInProgress.mode & StrictLegacyMode
      ) {
        setIsStrictModeForDevtools(true);
        try {
          value = renderWithHooks(
            null,
            workInProgress,
            Component,
            props,
            context,
            renderLanes,
          );
          hasId = checkDidRenderIdHook();
        } finally {
          setIsStrictModeForDevtools(false);
        }
      }
    }

    if (getIsHydrating() && hasId) {
      pushMaterializedTreeId(workInProgress);
    }

    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    reconcileChildren(null, workInProgress, value, renderLanes); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    if (__DEV__) {
      validateFunctionComponentInDev(workInProgress, Component);
    }
    return workInProgress.child; // +++++++++++++++++++++++++++++++++++++++++++++++++++++
  }
}

function validateFunctionComponentInDev(workInProgress: Fiber, Component: any) {
  if (__DEV__) {
    if (Component) {
      if (Component.childContextTypes) {
        console.error(
          '%s(...): childContextTypes cannot be defined on a function component.',
          Component.displayName || Component.name || 'Component',
        );
      }
    }
    if (workInProgress.ref !== null) {
      let info = '';
      const ownerName = getCurrentFiberOwnerNameInDevOrNull();
      if (ownerName) {
        info += '\n\nCheck the render method of `' + ownerName + '`.';
      }

      let warningKey = ownerName || '';
      const debugSource = workInProgress._debugSource;
      if (debugSource) {
        warningKey = debugSource.fileName + ':' + debugSource.lineNumber;
      }
      if (!didWarnAboutFunctionRefs[warningKey]) {
        didWarnAboutFunctionRefs[warningKey] = true;
        console.error(
          'Function components cannot be given refs. ' +
            'Attempts to access this ref will fail. ' +
            'Did you mean to use React.forwardRef()?%s',
          info,
        );
      }
    }

    if (
      warnAboutDefaultPropsOnFunctionComponents &&
      Component.defaultProps !== undefined
    ) {
      const componentName = getComponentNameFromType(Component) || 'Unknown';

      if (!didWarnAboutDefaultPropsOnFunctionComponent[componentName]) {
        console.error(
          '%s: Support for defaultProps will be removed from function components ' +
            'in a future major release. Use JavaScript default parameters instead.',
          componentName,
        );
        didWarnAboutDefaultPropsOnFunctionComponent[componentName] = true;
      }
    }

    if (typeof Component.getDerivedStateFromProps === 'function') {
      const componentName = getComponentNameFromType(Component) || 'Unknown';

      if (!didWarnAboutGetDerivedStateOnFunctionComponent[componentName]) {
        console.error(
          '%s: Function components do not support getDerivedStateFromProps.',
          componentName,
        );
        didWarnAboutGetDerivedStateOnFunctionComponent[componentName] = true;
      }
    }

    if (
      typeof Component.contextType === 'object' &&
      Component.contextType !== null
    ) {
      const componentName = getComponentNameFromType(Component) || 'Unknown';

      if (!didWarnAboutContextTypeOnFunctionComponent[componentName]) {
        console.error(
          '%s: Function components do not support contextType.',
          componentName,
        );
        didWarnAboutContextTypeOnFunctionComponent[componentName] = true;
      }
    }
  }
}

// +++
const SUSPENDED_MARKER: SuspenseState = { // +++
  dehydrated: null,
  treeContext: null,
  retryLane: NoLane, // 0
}; // +++
// +++

// ++++++
function mountSuspenseOffscreenState(renderLanes: Lanes): OffscreenState { // +++
  // +++ 一个对象 // +++
  return {
    baseLanes: renderLanes,
    cachePool: getSuspendedCache(),
  };
}

function updateSuspenseOffscreenState(
  prevOffscreenState: OffscreenState,
  renderLanes: Lanes,
): OffscreenState {
  let cachePool: SpawnedCachePool | null = null;
  if (enableCache) {
    const prevCachePool: SpawnedCachePool | null = prevOffscreenState.cachePool;
    if (prevCachePool !== null) {
      const parentCache = isPrimaryRenderer
        ? CacheContext._currentValue
        : CacheContext._currentValue2;
      if (prevCachePool.parent !== parentCache) {
        // Detected a refresh in the parent. This overrides any previously
        // suspended cache.
        cachePool = {
          parent: parentCache,
          pool: parentCache,
        };
      } else {
        // We can reuse the cache from last time. The only thing that would have
        // overridden it is a parent refresh, which we checked for above.
        cachePool = prevCachePool;
      }
    } else {
      // If there's no previous cache pool, grab the current one.
      cachePool = getSuspendedCache();
    }
  }
  return {
    baseLanes: mergeLanes(prevOffscreenState.baseLanes, renderLanes),
    cachePool,
  };
}

// 是否应该在fallback上保持 // +++
// TODO: Probably should inline this back
function shouldRemainOnFallback(
  current: null | Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  // If we're already showing a fallback, there are cases where we need to
  // remain on that fallback regardless of whether the content has resolved.
  // For example, SuspenseList coordinates when nested content appears.
  if (current !== null) { // +++
    const suspenseState: SuspenseState = current.memoizedState; // +++
    if (suspenseState === null) { // +++
      // Currently showing content. Don't hide it, even if ForceSuspenseFallback
      // is true. More precise name might be "ForceRemainSuspenseFallback".
      // Note: This is a factoring smell. Can't remain on a fallback if there's
      // no fallback to remain on.
      return false; // +++
    }
  }

  // Not currently showing content. Consult the Suspense context.
  const suspenseContext: SuspenseContext = suspenseStackCursor.current;
  return hasSuspenseListContext( // packages/react-reconciler/src/ReactFiberSuspenseContext.new.js // +++
    suspenseContext,
    (ForceSuspenseFallback: SuspenseContext), // +++
  );
}

function getRemainingWorkInPrimaryTree(current: Fiber, renderLanes) {
  // TODO: Should not remove render lanes that were pinged during this render
  return removeLanes(current.childLanes, renderLanes);
}

// 更新suspense组件 // +++
function updateSuspenseComponent(current, workInProgress, renderLanes) {

  // <Suspense>组件上的属性 // +++
  const nextProps = workInProgress.pendingProps;

  // This is used by DevTools to force a boundary to suspend.
  if (__DEV__) {
    if (shouldSuspend(workInProgress)) {
      workInProgress.flags |= DidCapture;
    }
  }

  // 是否展示fallback // +++
  let showFallback = false;

  // 是否已经挂起 // +++
  const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags; // 是否有已经捕获的标记 // +++ // 刚开始是没有的 // 在之后的resumeSuspendedUnitOfWork中就有了 // 要注意 +++
  // +++

  if (
    didSuspend ||
    shouldRemainOnFallback(current, workInProgress, renderLanes) // 是否应该在fallback上保持 // +++ -> false
  ) {
    // Something in this boundary's subtree already suspended. Switch to
    // rendering the fallback children.
    showFallback = true; // 标记展示fallback // ++++++
    // +++

    // 【去除】DidCapture标记 // +++
    workInProgress.flags &= ~DidCapture;
  }

  // OK, the next part is confusing. We're about to reconcile the Suspense
  // boundary's children. This involves some custom reconciliation logic. Two
  // main reasons this is so complicated.
  //
  // First, Legacy Mode has different semantics for backwards compatibility. The
  // primary tree will commit in an inconsistent state, so when we do the
  // second pass to render the fallback, we do some exceedingly, uh, clever
  // hacks to make that not totally break. Like transferring effects and
  // deletions from hidden tree. In Concurrent Mode, it's much simpler,
  // because we bailout on the primary tree completely and leave it in its old
  // state, no effects. Same as what we do for Offscreen (except that
  // Offscreen doesn't have the first render pass).
  //
  // Second is hydration. During hydration, the Suspense fiber has a slightly
  // different layout, where the child points to a dehydrated fragment, which
  // contains the DOM rendered by the server.
  //
  // Third, even if you set all that aside, Suspense is like error boundaries in
  // that we first we try to render one tree, and if that fails, we render again
  // and switch to a different tree. Like a try/catch block. So we have to track
  // which branch we're currently rendering. Ideally we would model this using
  // a stack.
  if (current === null) { // 初始化挂载 // +++
    // Initial mount

    // Special path for hydration
    // If we're currently hydrating, try to hydrate this boundary.
    if (getIsHydrating()) {
      // We must push the suspense handler context *before* attempting to
      // hydrate, to avoid a mismatch in case it errors.
      if (showFallback) {
        pushPrimaryTreeSuspenseHandler(workInProgress);
      } else {
        pushFallbackTreeSuspenseHandler(workInProgress);
      }
      tryToClaimNextHydratableInstance(workInProgress);
      // This could've been a dehydrated suspense component.
      const suspenseState: null | SuspenseState = workInProgress.memoizedState;
      if (suspenseState !== null) {
        const dehydrated = suspenseState.dehydrated;
        if (dehydrated !== null) {
          return mountDehydratedSuspenseComponent(
            workInProgress,
            dehydrated,
            renderLanes,
          );
        }
      }
      // If hydration didn't succeed, fall through to the normal Suspense path.
      // To avoid a stack mismatch we need to pop the Suspense handler that we
      // pushed above. This will become less awkward when move the hydration
      // logic to its own fiber.
      popSuspenseHandler(workInProgress);
    }

    // 取出children和fallback属性 // +++
    const nextPrimaryChildren = nextProps.children;
    const nextFallbackChildren = nextProps.fallback;

    if (showFallback) { // ++++++
      pushFallbackTreeSuspenseHandler(workInProgress);

      // 挂载挂起fallback的孩子 // +++
      const fallbackFragment = mountSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes,
      );
      // 这个操作之后SuspenseComponent fiber的child就是一个新的primaryChildFragment（OffscreenComponent），而primaryChildFragment的sibling就是fallbackChildFragment（fragment）



      // 它是一个新的OffscreenComponent fiber - 注意它和之前的不是同一个（它的pendingProps中的mode是hidden不再是mountSuspensePrimaryChildren中的visible了），是一个新的因为在上面的mountSuspenseFallbackChildren中做的事情 // +++
      const primaryChildFragment: Fiber = (workInProgress.child: any);
      
      
      /// 挂载挂起离屏状态 // +++
      primaryChildFragment.memoizedState = mountSuspenseOffscreenState( // +++
        renderLanes,
      ); // +++


      // suspense的memoizedState
      workInProgress.memoizedState = SUSPENDED_MARKER; // +++ // 在completeWork中起作用的
      // +++


      if (enableTransitionTracing) {
        const currentTransitions = getPendingTransitions();
        if (currentTransitions !== null) {
          const parentMarkerInstances = getMarkerInstances();
          const offscreenQueue: OffscreenQueue | null = (primaryChildFragment.updateQueue: any);
          if (offscreenQueue === null) {
            const newOffscreenQueue: OffscreenQueue = {
              transitions: currentTransitions,
              markerInstances: parentMarkerInstances,
              wakeables: null,
            };
            primaryChildFragment.updateQueue = newOffscreenQueue;
          } else {
            offscreenQueue.transitions = currentTransitions;
            offscreenQueue.markerInstances = parentMarkerInstances;
          }
        }
      }

      // 返回这个fallbackFragment - 它是一个fragment // +++
      return fallbackFragment;
      /* 
      此时suspense fiber的child是一个新的OffscreenComponet（它的pendingProps中的mode是hidden），同时这个OffscreenComponent的sibling是一个关于fallback的fragment fiber // +++

      当然还要知道此时的SuspenseComponent的updateQueue中是一个set，元素为promise值 // 这个是在workLoopSync -> resumeSuspendedUnitOfWork -> throwException中做的事情 // +++
      */

      // 那么接下来就到了completeWork和commitRootImpl啦 // +++
      // completeWork主要是进行给SuspenseComponent的flags加上Update标记，同时给SuspenseComponent的child: OffscreenComponent的flags加上Visibility这个标记 // +++
      // commitRootImpl: case SuspenseComponent: attachSuspenseRetryListeners -> 给它的updateQueue中的promise注册回调 -> resolveRetryWakeable -> retryTimedOutBoundary（重点） // +++
      
      // 对于初次挂载其实在completeWork -> case HostComponent: appendAllChildren其实就已经把fallback加入到它的父级的真实dom中去了
      // 或者是在commitMutationEffects中case FunctionComponent: commitReconciliationEffects -> commitPlacement（具体看详细逻辑） // +++
    } else if (
      enableCPUSuspense &&
      typeof nextProps.unstable_expectedLoadTime === 'number'
    ) {
      // This is a CPU-bound tree. Skip this tree and show a placeholder to
      // unblock the surrounding content. Then immediately retry after the
      // initial commit.
      pushFallbackTreeSuspenseHandler(workInProgress);
      const fallbackFragment = mountSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes,
      );
      const primaryChildFragment: Fiber = (workInProgress.child: any);
      primaryChildFragment.memoizedState = mountSuspenseOffscreenState(
        renderLanes,
      );
      workInProgress.memoizedState = SUSPENDED_MARKER;

      // TODO: Transition Tracing is not yet implemented for CPU Suspense.

      // Since nothing actually suspended, there will nothing to ping this to
      // get it started back up to attempt the next item. While in terms of
      // priority this work has the same priority as this current render, it's
      // not part of the same transition once the transition has committed. If
      // it's sync, we still want to yield so that it can be painted.
      // Conceptually, this is really the same as pinging. We can use any
      // RetryLane even if it's the one currently rendering since we're leaving
      // it behind on this node.
      workInProgress.lanes = SomeRetryLane;
      return fallbackFragment;
    } else {

      // +++
      pushPrimaryTreeSuspenseHandler(workInProgress);

      // 挂载suspense主要孩子 // +++
      return mountSuspensePrimaryChildren(
        workInProgress,
        nextPrimaryChildren,
        renderLanes,
      );
      /* 
      此时的suspense的wip的child是一个tag为OffscreenComponent的fiber // +++
      */
    }
  } else {
    
    // 更新 // +++


    // This is an update.

    // Special path for hydration
    const prevState: null | SuspenseState = current.memoizedState;
    if (prevState !== null) {
      const dehydrated = prevState.dehydrated; // null
      if (dehydrated !== null) {
        return updateDehydratedSuspenseComponent(
          current,
          workInProgress,
          didSuspend,
          nextProps,
          dehydrated,
          prevState,
          renderLanes,
        );
      }
    }

    // +++
    if (showFallback) { // +++
      pushFallbackTreeSuspenseHandler(workInProgress);

      const nextFallbackChildren = nextProps.fallback;
      const nextPrimaryChildren = nextProps.children;

      // 更新fallback孩子 // +++
      const fallbackChildFragment = updateSuspenseFallbackChildren(
        current,
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes,
      );
      /* 
      SuspenseComponent的child是一个OffscreenComponent（它的pendingProps的mode是一个hidden），同时他又有一个sibling是关于fallback的Fragment（flags加上Placement） // +++

      // 这里是重点
      +++注意此时的这个OffscreenComponent fiber它是有child fiber - 因为它是复用的current OffscreenComponent fiber的child - 那么刚好是current FunctionComponent fiber // +++

      同时此时的SuspenseComponent fiber的updateQueue是一个存有promise的set（在workLoopSync -> resumeSuspendedUnitOfWork -> throwException）
      */
      // 那么之前的FunctionComponent应该删除它的，那么这个是在哪一步做的呢？
      // 经过调试得知这里没有做
      // 它是在commitMutationEffectsOnFiber -> case OffscreenComponent: hideOrUnhideAllChildren（做的）
      // 真实dom并没有被删除而是直接添加style中的display: none !important了
      // ++++++

      // OffscreenComponent fiber
      const primaryChildFragment: Fiber = (workInProgress.child: any);


      // +++
      const prevOffscreenState: OffscreenState | null = (current.child: any)
        .memoizedState; // +++
      
      // +++
      primaryChildFragment.memoizedState =
        prevOffscreenState === null // +++
          ? mountSuspenseOffscreenState(renderLanes) // +++
          : updateSuspenseOffscreenState(prevOffscreenState, renderLanes); // +++
      // +++
      
      if (enableTransitionTracing) {
        const currentTransitions = getPendingTransitions();
        if (currentTransitions !== null) {
          const parentMarkerInstances = getMarkerInstances();
          const offscreenQueue: OffscreenQueue | null = (primaryChildFragment.updateQueue: any);
          const currentOffscreenQueue: OffscreenQueue | null = (current.updateQueue: any);
          if (offscreenQueue === null) {
            const newOffscreenQueue: OffscreenQueue = {
              transitions: currentTransitions,
              markerInstances: parentMarkerInstances,
              wakeables: null,
            };
            primaryChildFragment.updateQueue = newOffscreenQueue;
          } else if (offscreenQueue === currentOffscreenQueue) {
            // If the work-in-progress queue is the same object as current, we
            // can't modify it without cloning it first.
            const newOffscreenQueue: OffscreenQueue = {
              transitions: currentTransitions,
              markerInstances: parentMarkerInstances,
              wakeables:
                currentOffscreenQueue !== null
                  ? currentOffscreenQueue.wakeables
                  : null,
            };
            primaryChildFragment.updateQueue = newOffscreenQueue;
          } else {
            offscreenQueue.transitions = currentTransitions;
            offscreenQueue.markerInstances = parentMarkerInstances;
          }
        }
      }

      // +++
      primaryChildFragment.childLanes = getRemainingWorkInPrimaryTree(
        current,
        renderLanes,
      );

      // +++
      workInProgress.memoizedState = SUSPENDED_MARKER; // +++
      // +++
      /* 
      // +++
const SUSPENDED_MARKER: SuspenseState = { // +++
  dehydrated: null,
  treeContext: null,
  retryLane: NoLane, // 0
}; // +++
// +++
      */
      
      // +++
      return fallbackChildFragment; // 返回关于fallback的Fragment
    } else {

      // +++

      pushPrimaryTreeSuspenseHandler(workInProgress);

      const nextPrimaryChildren = nextProps.children;

      // 更新挂起主要孩子 // +++
      const primaryChildFragment = updateSuspensePrimaryChildren(
        current,
        workInProgress,
        nextPrimaryChildren,
        renderLanes,
      );
      // 这里主要是让SuspenseComponent对应的fiber wip的child是一个OffscreenComponent fiber（pendingProps中的mode为Visibility），但是这个OffscreenComponent fiber没有child也没有sibling
      
      // OffscreenComponent fiber的sibling一定是为null的，但是它的child会去复用对应current的（?alternate | 反正是createWorkIProgress那一套） // +++ 要注意！！！
      // 它的pendingProps为
      // {
      //   mode: 'visible',
      //   children: primaryChildren,
      // }, // +++


      // 但是display: none !important隐藏的A组件虽然被隐藏了，但是在哪里最终真实dom被删除了呢？
      // 答案是在commitMutationEffectsOnFiber -> case OffscreenComponent: deletions中删除的 - 也就是存储了之前的本是LazyComponent但是为FunctionComponent的fiber - 它是要删除的
      // 那么它是在beginWork -> updateOffscreenComponent -> reconcileChildren（diff算法中） -> 那么在reconcileSingleElement中由于
      // key虽然是相等的但是elementType是不相等的，那么直接把current child也就是FunctionComponent fiber加入到OffscreenComponent fiber的deletions数组并给这个fiber的flags加上ChildDeletion标记啦~
      // 那么所以在commitMutationEffectsOnFiber -> case OffscreenComponent:中就可以进行删除了 // +++

      // +++
      // 注意：此时的wip的flags是加上ChildDeletion的，同时它的deletions属性是推入了current fiber的child的sibling也就是一个关于fallback的fragment的current fiber
      // 这样做是为了把fallback给删除了 // +++
      // +++


      // ++++++
      // 注意点：// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      workInProgress.memoizedState = null; // 置为null // +++ // 不要把左右缓冲树先后顺序搞反了（重点） // ++++++
      // 另外注意提交fallback是一个场景 - 提交主要孩子又是一个场景（提交它时不需要应该fallback了之后也没有报错就正常render了，所以它的memoizedState就变为null，这就导致之后的current的memoizedState就是null啦 ~） // +++
      // ++++++


      // 返回OffscreenComponent fiber
      return primaryChildFragment;

      // 之后OffscreenComponent fiber的child就是一个LazyComponent fiber，然后又变为了FunctionComponent fiber（那么它的child就是函数式组件返回的react元素对应的fiber） // +++

      
    }
  }
}

// 挂载suspense主要孩子 // +++
function mountSuspensePrimaryChildren(
  workInProgress,
  primaryChildren,
  renderLanes,
) {
  const mode = workInProgress.mode;

  // 准备主要孩子属性对象 // +++
  const primaryChildProps: OffscreenProps = {
    mode: 'visible', // +++
    children: primaryChildren,
  };


  // 挂载wip画面以外的fiber // +++
  const primaryChildFragment = mountWorkInProgressOffscreenFiber(
    primaryChildProps,
    mode,
    renderLanes,
  );


  // +++
  primaryChildFragment.return = workInProgress;
  workInProgress.child = primaryChildFragment;

  // 返回主要孩子fragment
  return primaryChildFragment;
}

// 挂载挂起fallback孩子 // +++
function mountSuspenseFallbackChildren(
  workInProgress,
  primaryChildren,
  fallbackChildren,
  renderLanes,
) {
  const mode = workInProgress.mode;
  const progressedPrimaryFragment: Fiber | null = workInProgress.child; // SuspenseComponent的孩子也就是OffScreenComponent

  // 主要孩子属性
  const primaryChildProps: OffscreenProps = {
    mode: 'hidden', /// +++
    children: primaryChildren, // 主要孩子
  };

  let primaryChildFragment;
  let fallbackChildFragment;
  if (
    (mode & ConcurrentMode) === NoMode &&
    progressedPrimaryFragment !== null
  ) {
    // In legacy mode, we commit the primary tree as if it successfully
    // completed, even though it's in an inconsistent state.
    primaryChildFragment = progressedPrimaryFragment;
    primaryChildFragment.childLanes = NoLanes;
    primaryChildFragment.pendingProps = primaryChildProps;

    if (enableProfilerTimer && workInProgress.mode & ProfileMode) {
      // Reset the durations from the first pass so they aren't included in the
      // final amounts. This seems counterintuitive, since we're intentionally
      // not measuring part of the render phase, but this makes it match what we
      // do in Concurrent Mode.
      primaryChildFragment.actualDuration = 0;
      primaryChildFragment.actualStartTime = -1;
      primaryChildFragment.selfBaseDuration = 0;
      primaryChildFragment.treeBaseDuration = 0;
    }

    fallbackChildFragment = createFiberFromFragment(
      fallbackChildren,
      mode,
      renderLanes,
      null,
    );
  } else {

    // +++
    // 挂载wip离屏fiber
    primaryChildFragment = mountWorkInProgressOffscreenFiber(
      primaryChildProps,
      mode,
      NoLanes,
    );

    // +++
    // 从fragment创建fiber
    fallbackChildFragment = createFiberFromFragment(
      fallbackChildren,
      mode,
      renderLanes,
      null,
    );
  }

  primaryChildFragment.return = workInProgress;
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  // 这个操作之后SuspenseComponent fiber的child就是一个新的primaryChildFragment（OffscreenComponent），而primaryChildFragment的sibling就是fallbackChildFragment（fragment）

  return fallbackChildFragment;
}

// 挂载wip画面以外的fiber // +++
function mountWorkInProgressOffscreenFiber(
  offscreenProps: OffscreenProps,
  mode: TypeOfMode,
  renderLanes: Lanes,
) {
  // The props argument to `createFiberFromOffscreen` is `any` typed, so we use
  // this wrapper function to constrain it.
  return createFiberFromOffscreen(offscreenProps, mode, NoLanes, null); // 直接就是从离屏创建fiber // +++
}

// 更新wip离屏fiber // +++
function updateWorkInProgressOffscreenFiber(
  current: Fiber,
  offscreenProps: OffscreenProps,
) {
  // The props argument to `createWorkInProgress` is `any` typed, so we use this
  // wrapper function to constrain it.
  return createWorkInProgress(current, offscreenProps); // +++
}

// 更新挂起主要孩子 // +++
function updateSuspensePrimaryChildren(
  current,
  workInProgress,
  primaryChildren,
  renderLanes,
) {
  const currentPrimaryChildFragment: Fiber = (current.child: any); // OffscreenComponent fiber


  // 一个关于fallback的fragment // +++
  const currentFallbackChildFragment: Fiber | null =
    currentPrimaryChildFragment.sibling;

  // 更新wip离屏fiber // +++
  const primaryChildFragment = updateWorkInProgressOffscreenFiber(
    currentPrimaryChildFragment,
    {
      mode: 'visible',
      children: primaryChildren,
    }, // +++
  );
  // 就是createWorkInProgress的api的封装 // +++


  if ((workInProgress.mode & ConcurrentMode) === NoMode) {
    primaryChildFragment.lanes = renderLanes;
  }


  // +++
  primaryChildFragment.return = workInProgress;
  primaryChildFragment.sibling = null;
  // +++


  // +++
  if (currentFallbackChildFragment !== null) {
    // Delete the fallback child fragment
    const deletions = workInProgress.deletions;
    if (deletions === null) {
      workInProgress.deletions = [currentFallbackChildFragment]; // +++
      workInProgress.flags |= ChildDeletion; // ++++++
    } else {
      deletions.push(currentFallbackChildFragment); // +++
    }
  }


  // +++
  workInProgress.child = primaryChildFragment;
  
  
  // +++
  return primaryChildFragment;
}

// 更新suspense fallback孩子 // +++
function updateSuspenseFallbackChildren(
  current,
  workInProgress,
  primaryChildren,
  fallbackChildren,
  renderLanes,
) {
  const mode = workInProgress.mode;

  // OffscreenComponent fiber
  const currentPrimaryChildFragment: Fiber = (current.child: any);

  // null ?
  const currentFallbackChildFragment: Fiber | null =
    currentPrimaryChildFragment.sibling;

  // +++
  const primaryChildProps: OffscreenProps = {
    mode: 'hidden', // +++
    children: primaryChildren, // +++
  };

  let primaryChildFragment;
  if (
    // In legacy mode, we commit the primary tree as if it successfully
    // completed, even though it's in an inconsistent state.
    (mode & ConcurrentMode) === NoMode &&
    // Make sure we're on the second pass, i.e. the primary child fragment was
    // already cloned. In legacy mode, the only case where this isn't true is
    // when DevTools forces us to display a fallback; we skip the first render
    // pass entirely and go straight to rendering the fallback. (In Concurrent
    // Mode, SuspenseList can also trigger this scenario, but this is a legacy-
    // only codepath.)
    workInProgress.child !== currentPrimaryChildFragment
  ) {
    const progressedPrimaryFragment: Fiber = (workInProgress.child: any);
    primaryChildFragment = progressedPrimaryFragment;
    primaryChildFragment.childLanes = NoLanes;
    primaryChildFragment.pendingProps = primaryChildProps;

    if (enableProfilerTimer && workInProgress.mode & ProfileMode) {
      // Reset the durations from the first pass so they aren't included in the
      // final amounts. This seems counterintuitive, since we're intentionally
      // not measuring part of the render phase, but this makes it match what we
      // do in Concurrent Mode.
      primaryChildFragment.actualDuration = 0;
      primaryChildFragment.actualStartTime = -1;
      primaryChildFragment.selfBaseDuration =
        currentPrimaryChildFragment.selfBaseDuration;
      primaryChildFragment.treeBaseDuration =
        currentPrimaryChildFragment.treeBaseDuration;
    }

    // The fallback fiber was added as a deletion during the first pass.
    // However, since we're going to remain on the fallback, we no longer want
    // to delete it.
    workInProgress.deletions = null;
  } else {

    // +++
    primaryChildFragment = updateWorkInProgressOffscreenFiber(
      currentPrimaryChildFragment,
      primaryChildProps,
    );
    // Since we're reusing a current tree, we need to reuse the flags, too.
    // (We don't do this in legacy mode, because in legacy mode we don't re-use
    // the current tree; see previous branch.)
    primaryChildFragment.subtreeFlags =
      currentPrimaryChildFragment.subtreeFlags & StaticMask;
  }


  // +++
  let fallbackChildFragment;
  if (currentFallbackChildFragment !== null) {
    fallbackChildFragment = createWorkInProgress(
      currentFallbackChildFragment,
      fallbackChildren,
    );
  } else {
    fallbackChildFragment = createFiberFromFragment(
      fallbackChildren,
      mode,
      renderLanes,
      null,
    );
    // Needs a placement effect because the parent (the Suspense boundary) already
    // mounted but this is a new fiber.
    fallbackChildFragment.flags |= Placement; // +++
  }



  // +++
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;
  // +++


  // +++
  return fallbackChildFragment;
}

function retrySuspenseComponentWithoutHydrating(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
  recoverableError: CapturedValue<mixed> | null,
) {
  // Falling back to client rendering. Because this has performance
  // implications, it's considered a recoverable error, even though the user
  // likely won't observe anything wrong with the UI.
  //
  // The error is passed in as an argument to enforce that every caller provide
  // a custom message, or explicitly opt out (currently the only path that opts
  // out is legacy mode; every concurrent path provides an error).
  if (recoverableError !== null) {
    queueHydrationError(recoverableError);
  }

  // This will add the old fiber to the deletion list
  reconcileChildFibers(workInProgress, current.child, null, renderLanes);

  // We're now not suspended nor dehydrated.
  const nextProps = workInProgress.pendingProps;
  const primaryChildren = nextProps.children;
  const primaryChildFragment = mountSuspensePrimaryChildren(
    workInProgress,
    primaryChildren,
    renderLanes,
  );
  // Needs a placement effect because the parent (the Suspense boundary) already
  // mounted but this is a new fiber.
  primaryChildFragment.flags |= Placement;
  workInProgress.memoizedState = null;

  return primaryChildFragment;
}

function mountSuspenseFallbackAfterRetryWithoutHydrating(
  current,
  workInProgress,
  primaryChildren,
  fallbackChildren,
  renderLanes,
) {
  const fiberMode = workInProgress.mode;
  const primaryChildProps: OffscreenProps = {
    mode: 'visible',
    children: primaryChildren,
  };
  const primaryChildFragment = mountWorkInProgressOffscreenFiber(
    primaryChildProps,
    fiberMode,
    NoLanes,
  );
  const fallbackChildFragment = createFiberFromFragment(
    fallbackChildren,
    fiberMode,
    renderLanes,
    null,
  );
  // Needs a placement effect because the parent (the Suspense
  // boundary) already mounted but this is a new fiber.
  fallbackChildFragment.flags |= Placement;

  primaryChildFragment.return = workInProgress;
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  if ((workInProgress.mode & ConcurrentMode) !== NoMode) {
    // We will have dropped the effect list which contains the
    // deletion. We need to reconcile to delete the current child.
    reconcileChildFibers(workInProgress, current.child, null, renderLanes);
  }

  return fallbackChildFragment;
}

function mountDehydratedSuspenseComponent(
  workInProgress: Fiber,
  suspenseInstance: SuspenseInstance,
  renderLanes: Lanes,
): null | Fiber {
  // During the first pass, we'll bail out and not drill into the children.
  // Instead, we'll leave the content in place and try to hydrate it later.
  if ((workInProgress.mode & ConcurrentMode) === NoMode) {
    if (__DEV__) {
      console.error(
        'Cannot hydrate Suspense in legacy mode. Switch from ' +
          'ReactDOM.hydrate(element, container) to ' +
          'ReactDOMClient.hydrateRoot(container, <App />)' +
          '.render(element) or remove the Suspense components from ' +
          'the server rendered components.',
      );
    }
    workInProgress.lanes = laneToLanes(SyncLane);
  } else if (isSuspenseInstanceFallback(suspenseInstance)) {
    // This is a client-only boundary. Since we won't get any content from the server
    // for this, we need to schedule that at a higher priority based on when it would
    // have timed out. In theory we could render it in this pass but it would have the
    // wrong priority associated with it and will prevent hydration of parent path.
    // Instead, we'll leave work left on it to render it in a separate commit.

    // TODO This time should be the time at which the server rendered response that is
    // a parent to this boundary was displayed. However, since we currently don't have
    // a protocol to transfer that time, we'll just estimate it by using the current
    // time. This will mean that Suspense timeouts are slightly shifted to later than
    // they should be.
    // Schedule a normal pri update to render this content.
    workInProgress.lanes = laneToLanes(DefaultHydrationLane);
  } else {
    // We'll continue hydrating the rest at offscreen priority since we'll already
    // be showing the right content coming from the server, it is no rush.
    workInProgress.lanes = laneToLanes(OffscreenLane);
  }
  return null;
}

function updateDehydratedSuspenseComponent(
  current: Fiber,
  workInProgress: Fiber,
  didSuspend: boolean,
  nextProps: any,
  suspenseInstance: SuspenseInstance,
  suspenseState: SuspenseState,
  renderLanes: Lanes,
): null | Fiber {
  if (!didSuspend) {
    // This is the first render pass. Attempt to hydrate.
    pushPrimaryTreeSuspenseHandler(workInProgress);

    // We should never be hydrating at this point because it is the first pass,
    // but after we've already committed once.
    warnIfHydrating();

    if ((workInProgress.mode & ConcurrentMode) === NoMode) {
      return retrySuspenseComponentWithoutHydrating(
        current,
        workInProgress,
        renderLanes,
        // TODO: When we delete legacy mode, we should make this error argument
        // required — every concurrent mode path that causes hydration to
        // de-opt to client rendering should have an error message.
        null,
      );
    }

    if (isSuspenseInstanceFallback(suspenseInstance)) {
      // This boundary is in a permanent fallback state. In this case, we'll never
      // get an update and we'll never be able to hydrate the final content. Let's just try the
      // client side render instead.
      let digest, message, stack;
      if (__DEV__) {
        ({digest, message, stack} = getSuspenseInstanceFallbackErrorDetails(
          suspenseInstance,
        ));
      } else {
        ({digest} = getSuspenseInstanceFallbackErrorDetails(suspenseInstance));
      }

      let error;
      if (message) {
        // eslint-disable-next-line react-internal/prod-error-codes
        error = new Error(message);
      } else {
        error = new Error(
          'The server could not finish this Suspense boundary, likely ' +
            'due to an error during server rendering. Switched to ' +
            'client rendering.',
        );
      }
      (error: any).digest = digest;
      const capturedValue = createCapturedValue(error, digest, stack);
      return retrySuspenseComponentWithoutHydrating(
        current,
        workInProgress,
        renderLanes,
        capturedValue,
      );
    }

    if (
      enableLazyContextPropagation &&
      // TODO: Factoring is a little weird, since we check this right below, too.
      // But don't want to re-arrange the if-else chain until/unless this
      // feature lands.
      !didReceiveUpdate
    ) {
      // We need to check if any children have context before we decide to bail
      // out, so propagate the changes now.
      lazilyPropagateParentContextChanges(current, workInProgress, renderLanes);
    }

    // We use lanes to indicate that a child might depend on context, so if
    // any context has changed, we need to treat is as if the input might have changed.
    const hasContextChanged = includesSomeLane(renderLanes, current.childLanes);
    if (didReceiveUpdate || hasContextChanged) {
      // This boundary has changed since the first render. This means that we are now unable to
      // hydrate it. We might still be able to hydrate it using a higher priority lane.
      const root = getWorkInProgressRoot();
      if (root !== null) {
        const attemptHydrationAtLane = getBumpedLaneForHydration(
          root,
          renderLanes,
        );
        if (
          attemptHydrationAtLane !== NoLane &&
          attemptHydrationAtLane !== suspenseState.retryLane
        ) {
          // Intentionally mutating since this render will get interrupted. This
          // is one of the very rare times where we mutate the current tree
          // during the render phase.
          suspenseState.retryLane = attemptHydrationAtLane;
          // TODO: Ideally this would inherit the event time of the current render
          const eventTime = NoTimestamp;
          enqueueConcurrentRenderForLane(current, attemptHydrationAtLane);
          scheduleUpdateOnFiber(
            root,
            current,
            attemptHydrationAtLane,
            eventTime,
          );
        } else {
          // We have already tried to ping at a higher priority than we're rendering with
          // so if we got here, we must have failed to hydrate at those levels. We must
          // now give up. Instead, we're going to delete the whole subtree and instead inject
          // a new real Suspense boundary to take its place, which may render content
          // or fallback. This might suspend for a while and if it does we might still have
          // an opportunity to hydrate before this pass commits.
        }
      }

      // If we have scheduled higher pri work above, this will probably just abort the render
      // since we now have higher priority work, but in case it doesn't, we need to prepare to
      // render something, if we time out. Even if that requires us to delete everything and
      // skip hydration.
      // Delay having to do this as long as the suspense timeout allows us.
      renderDidSuspendDelayIfPossible();
      const capturedValue = createCapturedValue(
        new Error(
          'This Suspense boundary received an update before it finished ' +
            'hydrating. This caused the boundary to switch to client rendering. ' +
            'The usual way to fix this is to wrap the original update ' +
            'in startTransition.',
        ),
      );
      return retrySuspenseComponentWithoutHydrating(
        current,
        workInProgress,
        renderLanes,
        capturedValue,
      );
    } else if (isSuspenseInstancePending(suspenseInstance)) {
      // This component is still pending more data from the server, so we can't hydrate its
      // content. We treat it as if this component suspended itself. It might seem as if
      // we could just try to render it client-side instead. However, this will perform a
      // lot of unnecessary work and is unlikely to complete since it often will suspend
      // on missing data anyway. Additionally, the server might be able to render more
      // than we can on the client yet. In that case we'd end up with more fallback states
      // on the client than if we just leave it alone. If the server times out or errors
      // these should update this boundary to the permanent Fallback state instead.
      // Mark it as having captured (i.e. suspended).
      workInProgress.flags |= DidCapture;
      // Leave the child in place. I.e. the dehydrated fragment.
      workInProgress.child = current.child;
      // Register a callback to retry this boundary once the server has sent the result.
      const retry = retryDehydratedSuspenseBoundary.bind(null, current);
      registerSuspenseInstanceRetry(suspenseInstance, retry);
      return null;
    } else {
      // This is the first attempt.
      reenterHydrationStateFromDehydratedSuspenseInstance(
        workInProgress,
        suspenseInstance,
        suspenseState.treeContext,
      );
      const primaryChildren = nextProps.children;
      const primaryChildFragment = mountSuspensePrimaryChildren(
        workInProgress,
        primaryChildren,
        renderLanes,
      );
      // Mark the children as hydrating. This is a fast path to know whether this
      // tree is part of a hydrating tree. This is used to determine if a child
      // node has fully mounted yet, and for scheduling event replaying.
      // Conceptually this is similar to Placement in that a new subtree is
      // inserted into the React tree here. It just happens to not need DOM
      // mutations because it already exists.
      primaryChildFragment.flags |= Hydrating;
      return primaryChildFragment;
    }
  } else {
    // This is the second render pass. We already attempted to hydrated, but
    // something either suspended or errored.

    if (workInProgress.flags & ForceClientRender) {
      // Something errored during hydration. Try again without hydrating.
      pushPrimaryTreeSuspenseHandler(workInProgress);

      workInProgress.flags &= ~ForceClientRender;
      const capturedValue = createCapturedValue(
        new Error(
          'There was an error while hydrating this Suspense boundary. ' +
            'Switched to client rendering.',
        ),
      );
      return retrySuspenseComponentWithoutHydrating(
        current,
        workInProgress,
        renderLanes,
        capturedValue,
      );
    } else if ((workInProgress.memoizedState: null | SuspenseState) !== null) {
      // Something suspended and we should still be in dehydrated mode.
      // Leave the existing child in place.

      // Push to avoid a mismatch
      pushFallbackTreeSuspenseHandler(workInProgress);

      workInProgress.child = current.child;
      // The dehydrated completion pass expects this flag to be there
      // but the normal suspense pass doesn't.
      workInProgress.flags |= DidCapture;
      return null;
    } else {
      // Suspended but we should no longer be in dehydrated mode.
      // Therefore we now have to render the fallback.
      pushFallbackTreeSuspenseHandler(workInProgress);

      const nextPrimaryChildren = nextProps.children;
      const nextFallbackChildren = nextProps.fallback;
      const fallbackChildFragment = mountSuspenseFallbackAfterRetryWithoutHydrating(
        current,
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes,
      );
      const primaryChildFragment: Fiber = (workInProgress.child: any);
      primaryChildFragment.memoizedState = mountSuspenseOffscreenState(
        renderLanes,
      );
      workInProgress.memoizedState = SUSPENDED_MARKER;
      return fallbackChildFragment;
    }
  }
}

function scheduleSuspenseWorkOnFiber(
  fiber: Fiber,
  renderLanes: Lanes,
  propagationRoot: Fiber,
) {
  fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
  const alternate = fiber.alternate;
  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
  }
  scheduleContextWorkOnParentPath(fiber.return, renderLanes, propagationRoot);
}

function propagateSuspenseContextChange(
  workInProgress: Fiber,
  firstChild: null | Fiber,
  renderLanes: Lanes,
): void {
  // Mark any Suspense boundaries with fallbacks as having work to do.
  // If they were previously forced into fallbacks, they may now be able
  // to unblock.
  let node = firstChild;
  while (node !== null) {
    if (node.tag === SuspenseComponent) {
      const state: SuspenseState | null = node.memoizedState;
      if (state !== null) {
        scheduleSuspenseWorkOnFiber(node, renderLanes, workInProgress);
      }
    } else if (node.tag === SuspenseListComponent) {
      // If the tail is hidden there might not be an Suspense boundaries
      // to schedule work on. In this case we have to schedule it on the
      // list itself.
      // We don't have to traverse to the children of the list since
      // the list will propagate the change when it rerenders.
      scheduleSuspenseWorkOnFiber(node, renderLanes, workInProgress);
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === workInProgress) {
      return;
    }
    // $FlowFixMe[incompatible-use] found when upgrading Flow
    while (node.sibling === null) {
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      if (node.return === null || node.return === workInProgress) {
        return;
      }
      node = node.return;
    }
    // $FlowFixMe[incompatible-use] found when upgrading Flow
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

function findLastContentRow(firstChild: null | Fiber): null | Fiber {
  // This is going to find the last row among these children that is already
  // showing content on the screen, as opposed to being in fallback state or
  // new. If a row has multiple Suspense boundaries, any of them being in the
  // fallback state, counts as the whole row being in a fallback state.
  // Note that the "rows" will be workInProgress, but any nested children
  // will still be current since we haven't rendered them yet. The mounted
  // order may not be the same as the new order. We use the new order.
  let row = firstChild;
  let lastContentRow: null | Fiber = null;
  while (row !== null) {
    const currentRow = row.alternate;
    // New rows can't be content rows.
    if (currentRow !== null && findFirstSuspended(currentRow) === null) {
      lastContentRow = row;
    }
    row = row.sibling;
  }
  return lastContentRow;
}

type SuspenseListRevealOrder = 'forwards' | 'backwards' | 'together' | void;

function validateRevealOrder(revealOrder: SuspenseListRevealOrder) {
  if (__DEV__) {
    if (
      revealOrder !== undefined &&
      revealOrder !== 'forwards' &&
      revealOrder !== 'backwards' &&
      revealOrder !== 'together' &&
      !didWarnAboutRevealOrder[revealOrder]
    ) {
      didWarnAboutRevealOrder[revealOrder] = true;
      if (typeof revealOrder === 'string') {
        switch (revealOrder.toLowerCase()) {
          case 'together':
          case 'forwards':
          case 'backwards': {
            console.error(
              '"%s" is not a valid value for revealOrder on <SuspenseList />. ' +
                'Use lowercase "%s" instead.',
              revealOrder,
              revealOrder.toLowerCase(),
            );
            break;
          }
          case 'forward':
          case 'backward': {
            console.error(
              '"%s" is not a valid value for revealOrder on <SuspenseList />. ' +
                'React uses the -s suffix in the spelling. Use "%ss" instead.',
              revealOrder,
              revealOrder.toLowerCase(),
            );
            break;
          }
          default:
            console.error(
              '"%s" is not a supported revealOrder on <SuspenseList />. ' +
                'Did you mean "together", "forwards" or "backwards"?',
              revealOrder,
            );
            break;
        }
      } else {
        console.error(
          '%s is not a supported value for revealOrder on <SuspenseList />. ' +
            'Did you mean "together", "forwards" or "backwards"?',
          revealOrder,
        );
      }
    }
  }
}

function validateTailOptions(
  tailMode: SuspenseListTailMode,
  revealOrder: SuspenseListRevealOrder,
) {
  if (__DEV__) {
    if (tailMode !== undefined && !didWarnAboutTailOptions[tailMode]) {
      if (tailMode !== 'collapsed' && tailMode !== 'hidden') {
        didWarnAboutTailOptions[tailMode] = true;
        console.error(
          '"%s" is not a supported value for tail on <SuspenseList />. ' +
            'Did you mean "collapsed" or "hidden"?',
          tailMode,
        );
      } else if (revealOrder !== 'forwards' && revealOrder !== 'backwards') {
        didWarnAboutTailOptions[tailMode] = true;
        console.error(
          '<SuspenseList tail="%s" /> is only valid if revealOrder is ' +
            '"forwards" or "backwards". ' +
            'Did you mean to specify revealOrder="forwards"?',
          tailMode,
        );
      }
    }
  }
}

function validateSuspenseListNestedChild(childSlot: mixed, index: number) {
  if (__DEV__) {
    const isAnArray = isArray(childSlot);
    const isIterable =
      !isAnArray && typeof getIteratorFn(childSlot) === 'function';
    if (isAnArray || isIterable) {
      const type = isAnArray ? 'array' : 'iterable';
      console.error(
        'A nested %s was passed to row #%s in <SuspenseList />. Wrap it in ' +
          'an additional SuspenseList to configure its revealOrder: ' +
          '<SuspenseList revealOrder=...> ... ' +
          '<SuspenseList revealOrder=...>{%s}</SuspenseList> ... ' +
          '</SuspenseList>',
        type,
        index,
        type,
      );
      return false;
    }
  }
  return true;
}

function validateSuspenseListChildren(
  children: mixed,
  revealOrder: SuspenseListRevealOrder,
) {
  if (__DEV__) {
    if (
      (revealOrder === 'forwards' || revealOrder === 'backwards') &&
      children !== undefined &&
      children !== null &&
      children !== false
    ) {
      if (isArray(children)) {
        for (let i = 0; i < children.length; i++) {
          if (!validateSuspenseListNestedChild(children[i], i)) {
            return;
          }
        }
      } else {
        const iteratorFn = getIteratorFn(children);
        if (typeof iteratorFn === 'function') {
          const childrenIterator = iteratorFn.call(children);
          if (childrenIterator) {
            let step = childrenIterator.next();
            let i = 0;
            for (; !step.done; step = childrenIterator.next()) {
              if (!validateSuspenseListNestedChild(step.value, i)) {
                return;
              }
              i++;
            }
          }
        } else {
          console.error(
            'A single row was passed to a <SuspenseList revealOrder="%s" />. ' +
              'This is not useful since it needs multiple rows. ' +
              'Did you mean to pass multiple children or an array?',
            revealOrder,
          );
        }
      }
    }
  }
}

function initSuspenseListRenderState(
  workInProgress: Fiber,
  isBackwards: boolean,
  tail: null | Fiber,
  lastContentRow: null | Fiber,
  tailMode: SuspenseListTailMode,
): void {
  const renderState: null | SuspenseListRenderState =
    workInProgress.memoizedState;
  if (renderState === null) {
    workInProgress.memoizedState = ({
      isBackwards: isBackwards,
      rendering: null,
      renderingStartTime: 0,
      last: lastContentRow,
      tail: tail,
      tailMode: tailMode,
    }: SuspenseListRenderState);
  } else {
    // We can reuse the existing object from previous renders.
    renderState.isBackwards = isBackwards;
    renderState.rendering = null;
    renderState.renderingStartTime = 0;
    renderState.last = lastContentRow;
    renderState.tail = tail;
    renderState.tailMode = tailMode;
  }
}

// This can end up rendering this component multiple passes.
// The first pass splits the children fibers into two sets. A head and tail.
// We first render the head. If anything is in fallback state, we do another
// pass through beginWork to rerender all children (including the tail) with
// the force suspend context. If the first render didn't have anything in
// in fallback state. Then we render each row in the tail one-by-one.
// That happens in the completeWork phase without going back to beginWork.
function updateSuspenseListComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextProps = workInProgress.pendingProps;
  const revealOrder: SuspenseListRevealOrder = nextProps.revealOrder;
  const tailMode: SuspenseListTailMode = nextProps.tail;
  const newChildren = nextProps.children;

  validateRevealOrder(revealOrder);
  validateTailOptions(tailMode, revealOrder);
  validateSuspenseListChildren(newChildren, revealOrder);

  reconcileChildren(current, workInProgress, newChildren, renderLanes);

  let suspenseContext: SuspenseContext = suspenseStackCursor.current;

  const shouldForceFallback = hasSuspenseListContext(
    suspenseContext,
    (ForceSuspenseFallback: SuspenseContext),
  );
  if (shouldForceFallback) {
    suspenseContext = setShallowSuspenseListContext(
      suspenseContext,
      ForceSuspenseFallback,
    );
    workInProgress.flags |= DidCapture;
  } else {
    const didSuspendBefore =
      current !== null && (current.flags & DidCapture) !== NoFlags;
    if (didSuspendBefore) {
      // If we previously forced a fallback, we need to schedule work
      // on any nested boundaries to let them know to try to render
      // again. This is the same as context updating.
      propagateSuspenseContextChange(
        workInProgress,
        workInProgress.child,
        renderLanes,
      );
    }
    suspenseContext = setDefaultShallowSuspenseListContext(suspenseContext);
  }
  pushSuspenseListContext(workInProgress, suspenseContext);

  if ((workInProgress.mode & ConcurrentMode) === NoMode) {
    // In legacy mode, SuspenseList doesn't work so we just
    // use make it a noop by treating it as the default revealOrder.
    workInProgress.memoizedState = null;
  } else {
    switch (revealOrder) {
      case 'forwards': {
        const lastContentRow = findLastContentRow(workInProgress.child);
        let tail;
        if (lastContentRow === null) {
          // The whole list is part of the tail.
          // TODO: We could fast path by just rendering the tail now.
          tail = workInProgress.child;
          workInProgress.child = null;
        } else {
          // Disconnect the tail rows after the content row.
          // We're going to render them separately later.
          tail = lastContentRow.sibling;
          lastContentRow.sibling = null;
        }
        initSuspenseListRenderState(
          workInProgress,
          false, // isBackwards
          tail,
          lastContentRow,
          tailMode,
        );
        break;
      }
      case 'backwards': {
        // We're going to find the first row that has existing content.
        // At the same time we're going to reverse the list of everything
        // we pass in the meantime. That's going to be our tail in reverse
        // order.
        let tail = null;
        let row = workInProgress.child;
        workInProgress.child = null;
        while (row !== null) {
          const currentRow = row.alternate;
          // New rows can't be content rows.
          if (currentRow !== null && findFirstSuspended(currentRow) === null) {
            // This is the beginning of the main content.
            workInProgress.child = row;
            break;
          }
          const nextRow = row.sibling;
          row.sibling = tail;
          tail = row;
          row = nextRow;
        }
        // TODO: If workInProgress.child is null, we can continue on the tail immediately.
        initSuspenseListRenderState(
          workInProgress,
          true, // isBackwards
          tail,
          null, // last
          tailMode,
        );
        break;
      }
      case 'together': {
        initSuspenseListRenderState(
          workInProgress,
          false, // isBackwards
          null, // tail
          null, // last
          undefined,
        );
        break;
      }
      default: {
        // The default reveal order is the same as not having
        // a boundary.
        workInProgress.memoizedState = null;
      }
    }
  }
  return workInProgress.child;
}

// 更新portal组件
function updatePortalComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {

  // ./ReactFiberHostContext.new.js
  // 推入 // +++
  pushHostContainer(workInProgress, workInProgress.stateNode.containerInfo); // 真实dom节点容器 // +++

  // children // +++
  const nextChildren = workInProgress.pendingProps;

  // 初次挂载
  if (current === null) {
    
    // Portals are special because we don't append the children during mount
    // but at commit. Therefore we need to track insertions which the normal
    // flow doesn't do during mount. This doesn't happen at the root because
    // the root always starts with a "current" with a null child.
    // TODO: Consider unifying this with how the root works.
    // +++
    workInProgress.child = reconcileChildFibers( // +++ 这个api使用的直接是packages/react-reconciler/src/ReactChildFiber.new.js里面的reconcileChildFibers - 传入的参数是为true // 注意 +++
      workInProgress, // returnFiber
      null, // currentFirstChild
      nextChildren, // children
      renderLanes,
    ); // +++
    // 是这里影响的 // +++

    // 因为在这里使用的api是ReactChildFiber.new.js文件里面的reconcileChildFibers - 那么他传入的参数是为true的
    // 那么所以在placeSingleChild这个函数里面会给children这个fiber的flags加上Placement // +++ // 要注意！！！

    // 那么这个flags将直接影响在commitmutationEffects中case HostComponent:里面的commitReconciliationEffects
    // 那么就可以正常的进行挂载啦 ~ // +++

  } else {

    // 更新 // +++
    // +++
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
    // -> reconcileChildFibers

  }


  // +++
  return workInProgress.child;
}

let hasWarnedAboutUsingNoValuePropOnContextProvider = false;

// 更新上下文提供者 // +++
function updateContextProvider(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const providerType: ReactProviderType<any> = workInProgress.type; // react元素的type值 // +++
  const context: ReactContext<any> = providerType._context; // 就是createContext中的创建出来的context对象

  const newProps = workInProgress.pendingProps; // 它就是react元素的props对象
  const oldProps = workInProgress.memoizedProps;

  const newValue = newProps.value; // 取出react元素中props对象的value属性

  if (__DEV__) {
    if (!('value' in newProps)) {
      if (!hasWarnedAboutUsingNoValuePropOnContextProvider) {
        hasWarnedAboutUsingNoValuePropOnContextProvider = true;
        console.error(
          'The `value` prop is required for the `<Context.Provider>`. Did you misspell it or forget to pass it?',
        );
      }
    }
    const providerPropTypes = workInProgress.type.propTypes;

    if (providerPropTypes) {
      checkPropTypes(providerPropTypes, newProps, 'prop', 'Context.Provider');
    }
  }

  // packages/react-reconciler/src/ReactFiberNewContext.new.js
  // 推入提供者 // +++
  pushProvider(workInProgress, context, newValue); // +++
  // 其实大概的逻辑就是context._currentValue = newValue // ++++++

  if (enableLazyContextPropagation) {
    // In the lazy propagation implementation, we don't scan for matching
    // consumers until something bails out, because until something bails out
    // we're going to visit those nodes, anyway. The trade-off is that it shifts
    // responsibility to the consumer to track whether something has changed.
  } else {

    // wip的老属性是否有
    if (oldProps !== null) {
      // 老的value值
      const oldValue = oldProps.value;

      // Object.is算法
      if (is(oldValue, newValue)) { // +++
        // 没变。如果孩子也一样，请尽早救助。
        // No change. Bailout early if children are the same.
        if (
          oldProps.children === newProps.children &&
          !hasLegacyContextChanged()
        ) {
          // ++++++
          return bailoutOnAlreadyFinishedWork( // 新旧value的值一样且孩子也是一样的那么尽早的返回wip fiber的child的alternate并把它放在wip fiber的child上
          // 注意：在createWorkInProgress中wip fiber的child是还是指向current fiber的child的 // ++++++
            current,
            workInProgress,
            renderLanes,
          );
        }
      } else {

        // 上下文值更改。搜索匹配的【消费者】并【调度它们进行更新】。 // +++
        // The context value changed. Search for matching consumers and schedule
        // them to update.
        propagateContextChange(workInProgress, context, renderLanes); // +++
        // 传播上下文改变
      
      }
    }
  }

  const newChildren = newProps.children; // 取出react元素props对象的children属性

  // +++
  reconcileChildren(current, workInProgress, newChildren, renderLanes);

  // +++
  return workInProgress.child;
}

let hasWarnedAboutUsingContextAsConsumer = false;

// 更新上下文消费者 // +++
function updateContextConsumer( // +++
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  let context: ReactContext<any> = workInProgress.type; // 它其实就是react元素中的type也就是createContext所产生的context对象 // +++
  // The logic below for Context differs depending on PROD or DEV mode. In
  // DEV mode, we create a separate object for Context.Consumer that acts
  // like a proxy to Context. This proxy object adds unnecessary code in PROD
  // so we use the old behaviour (Context.Consumer references Context) to
  // reduce size and overhead. The separate object references context via
  // a property called "_context", which also gives us the ability to check
  // in DEV mode if this property exists or not and warn if it does not.
  if (__DEV__) {
    if ((context: any)._context === undefined) {
      // This may be because it's a Context (rather than a Consumer).
      // Or it may be because it's older React where they're the same thing.
      // We only want to warn if we're sure it's a new React.
      if (context !== context.Consumer) {
        if (!hasWarnedAboutUsingContextAsConsumer) {
          hasWarnedAboutUsingContextAsConsumer = true;
          console.error(
            'Rendering <Context> directly is not supported and will be removed in ' +
              'a future major release. Did you mean to render <Context.Consumer> instead?',
          );
        }
      }
    } else {
      context = (context: any)._context;
    }
  }


  const newProps = workInProgress.pendingProps; // 也就是react元素的props对象
  const render = newProps.children; // 取出children属性 - 它是一个函数 // +++
  /* 
  https://babeljs.io/repl
  <XxxContext.Consumer>
    {
      (xxx) => {
        return (xxx)
      }
    }
  </XxxContext.Consumer>
  */

  // "use strict";

  // /*#__PURE__*/React.createElement(XxxContext.Consumer, null, function (xxx) {
  //   return xxx;
  // });
  

  if (__DEV__) {
    if (typeof render !== 'function') {
      console.error(
        'A context consumer was rendered with multiple children, or a child ' +
          "that isn't a function. A context consumer expects a single child " +
          'that is a function. If you did pass a function, make sure there ' +
          'is no trailing or leading whitespace around it.',
      );
    }
  }


  // +++
  // 准备去读取上下文
  prepareToReadContext(workInProgress, renderLanes); // +++

  // 读取上下文
  // +++
  // 相当于useContext hook
  const newValue = readContext(context); // +++


  if (enableSchedulingProfiler) {
    markComponentRenderStarted(workInProgress);
  }


  let newChildren;
  
  
  if (__DEV__) {
    ReactCurrentOwner.current = workInProgress;
    setIsRendering(true);

    // 直接调用此函数返回它的新的孩子 // +++
    newChildren = render(newValue); // +++
    
    setIsRendering(false);
  } else {

    // +++
    newChildren = render(newValue); // +++
  
  }
  if (enableSchedulingProfiler) {
    markComponentRenderStopped();
  }

  // React DevTools reads this flag.
  workInProgress.flags |= PerformedWork; // +++

  // +++
  reconcileChildren(current, workInProgress, newChildren, renderLanes); // +++
  
  return workInProgress.child; // +++
}

function updateScopeComponent(current, workInProgress, renderLanes) {
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;

  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// 标记wip已接受更新 +++
export function markWorkInProgressReceivedUpdate() {
  didReceiveUpdate = true; // +++
}

export function checkIfWorkInProgressReceivedUpdate(): boolean {
  return didReceiveUpdate;
}

function resetSuspendedCurrentOnMountInLegacyMode(current, workInProgress) {
  if ((workInProgress.mode & ConcurrentMode) === NoMode) {
    if (current !== null) {
      // A lazy component only mounts if it suspended inside a non-
      // concurrent tree, in an inconsistent state. We want to treat it like
      // a new mount, even though an empty version of it already committed.
      // Disconnect the alternate pointers.
      current.alternate = null;
      workInProgress.alternate = null;
      // Since this is conceptually a new fiber, schedule a Placement effect
      workInProgress.flags |= Placement;
    }
  }
}

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function bailoutOnAlreadyFinishedWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  if (current !== null) {
    // Reuse previous dependencies
    workInProgress.dependencies = current.dependencies;
  }

  if (enableProfilerTimer) {
    // Don't update "base" render times for bailouts.
    stopProfilerTimerIfRunning(workInProgress);
  }

  markSkippedUpdateLanes(workInProgress.lanes);

  // Check if the children have any pending work.
  if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
    // The children don't have any work either. We can skip them.
    // TODO: Once we add back resuming, we should check if the children are
    // a work-in-progress set. If so, we need to transfer their effects.

    if (enableLazyContextPropagation && current !== null) {
      // Before bailing out, check if there are any context changes in
      // the children.
      lazilyPropagateParentContextChanges(current, workInProgress, renderLanes);
      if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
        return null;
      }
    } else {
      return null;
    }
  }

  // This fiber doesn't have work, but its subtree does. Clone the child
  // fibers and continue.
  cloneChildFibers(current, workInProgress);
  // 返回workInProgress的child属性 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return workInProgress.child; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

function remountFiber(
  current: Fiber,
  oldWorkInProgress: Fiber,
  newWorkInProgress: Fiber,
): Fiber | null {
  if (__DEV__) {
    const returnFiber = oldWorkInProgress.return;
    if (returnFiber === null) {
      // eslint-disable-next-line react-internal/prod-error-codes
      throw new Error('Cannot swap the root fiber.');
    }

    // Disconnect from the old current.
    // It will get deleted.
    current.alternate = null;
    oldWorkInProgress.alternate = null;

    // Connect to the new tree.
    newWorkInProgress.index = oldWorkInProgress.index;
    newWorkInProgress.sibling = oldWorkInProgress.sibling;
    newWorkInProgress.return = oldWorkInProgress.return;
    newWorkInProgress.ref = oldWorkInProgress.ref;

    // Replace the child/sibling pointers above it.
    if (oldWorkInProgress === returnFiber.child) {
      returnFiber.child = newWorkInProgress;
    } else {
      let prevSibling = returnFiber.child;
      if (prevSibling === null) {
        // eslint-disable-next-line react-internal/prod-error-codes
        throw new Error('Expected parent to have a child.');
      }
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      while (prevSibling.sibling !== oldWorkInProgress) {
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        prevSibling = prevSibling.sibling;
        if (prevSibling === null) {
          // eslint-disable-next-line react-internal/prod-error-codes
          throw new Error('Expected to find the previous sibling.');
        }
      }
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      prevSibling.sibling = newWorkInProgress;
    }

    // Delete the old fiber and place the new one.
    // Since the old fiber is disconnected, we have to schedule it manually.
    const deletions = returnFiber.deletions;
    if (deletions === null) {
      returnFiber.deletions = [current];
      returnFiber.flags |= ChildDeletion;
    } else {
      deletions.push(current);
    }

    newWorkInProgress.flags |= Placement;

    // Restart work from the new fiber.
    return newWorkInProgress;
  } else {
    throw new Error(
      'Did not expect this call in production. ' +
        'This is a bug in React. Please file an issue.',
    );
  }
}

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// 检查调度更新或上下文 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function checkScheduledUpdateOrContext(
  current: Fiber,
  renderLanes: Lanes,
): boolean {
  // Before performing an early bailout, we must check if there are pending
  // updates or context.
  const updateLanes = current.lanes; // 取出current的lanes
  if (includesSomeLane(updateLanes, renderLanes)) { // current的lanes是否包含这个renderLanes // +++++++++++++++++++++++++++++++++++++++++++++++++++
    // 包含则直接返回true // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    return true;
  }

  // 没有挂起的更新，但是因为上下文是惰性传播的，所以我们需要在退出之前检查上下文更改。
  // No pending update, but because context is propagated lazily, we need
  // to check for a context change before we bail out.
  if (enableLazyContextPropagation) {
    const dependencies = current.dependencies;
    if (dependencies !== null && checkIfContextChanged(dependencies)) {
      return true;
    }
  }

  // 其它的一律返回false // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return false;
}

// 如果没有调度更新试图较早的bail out // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function attemptEarlyBailoutIfNoScheduledUpdate(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  // This fiber does not have any pending work. Bailout without entering
  // the begin phase. There's still some bookkeeping we that needs to be done
  // in this optimized path, mostly pushing stuff onto the stack.
  switch (workInProgress.tag) {
    case HostRoot:
      pushHostRootContext(workInProgress);
      const root: FiberRoot = workInProgress.stateNode;
      pushRootTransition(workInProgress, root, renderLanes);

      if (enableTransitionTracing) {
        pushRootMarkerInstance(workInProgress);
      }

      if (enableCache) {
        const cache: Cache = current.memoizedState.cache;
        pushCacheProvider(workInProgress, cache);
      }
      resetHydrationState();
      break;
    case HostResource:
    case HostSingleton:
    case HostComponent:
      pushHostContext(workInProgress);
      break;
    case ClassComponent: {
      const Component = workInProgress.type;
      if (isLegacyContextProvider(Component)) {
        pushLegacyContextProvider(workInProgress);
      }
      break;
    }
    case HostPortal:
      pushHostContainer(workInProgress, workInProgress.stateNode.containerInfo);
      break;
    case ContextProvider: {
      const newValue = workInProgress.memoizedProps.value;
      const context: ReactContext<any> = workInProgress.type._context;
      pushProvider(workInProgress, context, newValue);
      break;
    }
    case Profiler:
      if (enableProfilerTimer) {
        // Profiler should only call onRender when one of its descendants actually rendered.
        const hasChildWork = includesSomeLane(
          renderLanes,
          workInProgress.childLanes,
        );
        if (hasChildWork) {
          workInProgress.flags |= Update;
        }

        if (enableProfilerCommitHooks) {
          // Reset effect durations for the next eventual effect phase.
          // These are reset during render to allow the DevTools commit hook a chance to read them,
          const stateNode = workInProgress.stateNode;
          stateNode.effectDuration = 0;
          stateNode.passiveEffectDuration = 0;
        }
      }
      break;
    case SuspenseComponent: {
      const state: SuspenseState | null = workInProgress.memoizedState;
      if (state !== null) {
        if (state.dehydrated !== null) {
          // We're not going to render the children, so this is just to maintain
          // push/pop symmetry
          pushPrimaryTreeSuspenseHandler(workInProgress);
          // We know that this component will suspend again because if it has
          // been unsuspended it has committed as a resolved Suspense component.
          // If it needs to be retried, it should have work scheduled on it.
          workInProgress.flags |= DidCapture;
          // We should never render the children of a dehydrated boundary until we
          // upgrade it. We return null instead of bailoutOnAlreadyFinishedWork.
          return null;
        }

        // If this boundary is currently timed out, we need to decide
        // whether to retry the primary children, or to skip over it and
        // go straight to the fallback. Check the priority of the primary
        // child fragment.
        const primaryChildFragment: Fiber = (workInProgress.child: any);
        const primaryChildLanes = primaryChildFragment.childLanes;
        if (includesSomeLane(renderLanes, primaryChildLanes)) {
          // The primary children have pending work. Use the normal path
          // to attempt to render the primary children again.
          return updateSuspenseComponent(current, workInProgress, renderLanes);
        } else {
          // The primary child fragment does not have pending work marked
          // on it
          pushPrimaryTreeSuspenseHandler(workInProgress);
          // The primary children do not have pending work with sufficient
          // priority. Bailout.
          const child = bailoutOnAlreadyFinishedWork(
            current,
            workInProgress,
            renderLanes,
          );
          if (child !== null) {
            // The fallback children have pending work. Skip over the
            // primary children and work on the fallback.
            return child.sibling;
          } else {
            // Note: We can return `null` here because we already checked
            // whether there were nested context consumers, via the call to
            // `bailoutOnAlreadyFinishedWork` above.
            return null;
          }
        }
      } else {
        pushPrimaryTreeSuspenseHandler(workInProgress);
      }
      break;
    }
    case SuspenseListComponent: {
      const didSuspendBefore = (current.flags & DidCapture) !== NoFlags;

      let hasChildWork = includesSomeLane(
        renderLanes,
        workInProgress.childLanes,
      );

      if (enableLazyContextPropagation && !hasChildWork) {
        // Context changes may not have been propagated yet. We need to do
        // that now, before we can decide whether to bail out.
        // TODO: We use `childLanes` as a heuristic for whether there is
        // remaining work in a few places, including
        // `bailoutOnAlreadyFinishedWork` and
        // `updateDehydratedSuspenseComponent`. We should maybe extract this
        // into a dedicated function.
        lazilyPropagateParentContextChanges(
          current,
          workInProgress,
          renderLanes,
        );
        hasChildWork = includesSomeLane(renderLanes, workInProgress.childLanes);
      }

      if (didSuspendBefore) {
        if (hasChildWork) {
          // If something was in fallback state last time, and we have all the
          // same children then we're still in progressive loading state.
          // Something might get unblocked by state updates or retries in the
          // tree which will affect the tail. So we need to use the normal
          // path to compute the correct tail.
          return updateSuspenseListComponent(
            current,
            workInProgress,
            renderLanes,
          );
        }
        // If none of the children had any work, that means that none of
        // them got retried so they'll still be blocked in the same way
        // as before. We can fast bail out.
        workInProgress.flags |= DidCapture;
      }

      // If nothing suspended before and we're rendering the same children,
      // then the tail doesn't matter. Anything new that suspends will work
      // in the "together" mode, so we can continue from the state we had.
      const renderState = workInProgress.memoizedState;
      if (renderState !== null) {
        // Reset to the "together" mode in case we've started a different
        // update in the past but didn't complete it.
        renderState.rendering = null;
        renderState.tail = null;
        renderState.lastEffect = null;
      }
      pushSuspenseListContext(workInProgress, suspenseStackCursor.current);

      if (hasChildWork) {
        break;
      } else {
        // If none of the children had any work, that means that none of
        // them got retried so they'll still be blocked in the same way
        // as before. We can fast bail out.
        return null;
      }
    }
    case OffscreenComponent:
    case LegacyHiddenComponent: {
      // Need to check if the tree still needs to be deferred. This is
      // almost identical to the logic used in the normal update path,
      // so we'll just enter that. The only difference is we'll bail out
      // at the next level instead of this one, because the child props
      // have not changed. Which is fine.
      // TODO: Probably should refactor `beginWork` to split the bailout
      // path from the normal path. I'm tempted to do a labeled break here
      // but I won't :)
      workInProgress.lanes = NoLanes;
      return updateOffscreenComponent(current, workInProgress, renderLanes);
    }
    case CacheComponent: {
      if (enableCache) {
        const cache: Cache = current.memoizedState.cache;
        pushCacheProvider(workInProgress, cache);
      }
      break;
    }
    case TracingMarkerComponent: {
      if (enableTransitionTracing) {
        const instance: TracingMarkerInstance | null = workInProgress.stateNode;
        if (instance !== null) {
          pushMarkerInstance(workInProgress, instance);
        }
      }
    }
  }

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

// 开始工作 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function beginWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  if (__DEV__) {
    if (workInProgress._debugNeedsRemount && current !== null) {
      // This will restart the begin phase with a new fiber.
      return remountFiber(
        current,
        workInProgress,
        createFiberFromTypeAndProps(
          workInProgress.type,
          workInProgress.key,
          workInProgress.pendingProps,
          workInProgress._debugOwner || null,
          workInProgress.mode,
          workInProgress.lanes,
        ),
      );
    }
  }

  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  if (current !== null) { // _++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    const oldProps = current.memoizedProps;
    const newProps = workInProgress.pendingProps;

    if (
      oldProps !== newProps ||
      hasLegacyContextChanged() ||
      // Force a re-render if the implementation changed due to hot reload:
      (__DEV__ ? workInProgress.type !== current.type : false)
    ) {
      // If props or context changed, mark the fiber as having performed work.
      // This may be unset if the props are determined to be equal later (memo).
      didReceiveUpdate = true;
    } else {
      // props和遗留context都没有更改。检查是否有挂起的更新或context更改。// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // Neither props nor legacy context changes. Check if there's a pending
      // update or context change.
      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // 是否有调度更新或者上下文 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      const hasScheduledUpdateOrContext = checkScheduledUpdateOrContext( // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        current, // 举例：第一次mount时这里current的lanes是16 renderLanes也为16
        // 在初次挂载完毕之后点击button这里current的lanes为0 renderLanes是为1的
        // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        /* 
        当前的beginWork函数的下面以及renderWithHooks（在Component函数执行之前）都有这句代码，它会把wip的lanes置为0，要注意的！
        workInProgress.lanes = NoLanes;
        */
        // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        /// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        renderLanes,
      );
      // 实际上是检查current的lanes是否包含renderLanes，包含则返回true，否则返回false // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // ！！！
      // 注意在packages/react-reconciler/src/ReactFiberConcurrentUpdates.new.js中的enqueueUpdate（重点）以及finishQueueingConcurrentUpdates -> markUpdateLaneFromFiberToRoot（重点）
      // 里面的逻辑！！！
      // ！！！一定不要忘记这里面的逻辑 // ++++++++++++++++++++++++++++++++++++++++++++
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

      if (
        !hasScheduledUpdateOrContext && // !false
        // If this is the second pass of an error or suspense boundary, there
        // may not be work scheduled on `current`, so we check for this flag.
        (workInProgress.flags & DidCapture) === NoFlags // true
        // 要求flags没有DidCapture - 那这个一般都是为true的，肯定是没有的 // ++++++++++++++++++++++++++++++++++
      ) {
        // No pending updates or context. Bail out now.
        didReceiveUpdate = false;
        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        return attemptEarlyBailoutIfNoScheduledUpdate( // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
          current,
          workInProgress,
          renderLanes,
          // +++++++++++++++++++++++++++++++++++++++++++++++++++++
          // ！！！
          // 注意在packages/react-reconciler/src/ReactFiberConcurrentUpdates.new.js中的enqueueUpdate以及finishQueueingConcurrentUpdates -> markUpdateLaneFromFiberToRoot
          // 里面的逻辑！！！
          // ！！！一定不要忘记这里面的逻辑 // ++++++++++++++++++++++++++++++++++++++++++++
          // +++++++++++++++++++++++++++++++++++++++++++++++++++++
          // 另外还要注意prepareFreshStack中的逻辑：让wip复用current的大部分属性，所以在那里的时候wip的child就已经指向了current的child的 // ++++++++++++++++++++++++++++++++++++
          // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        );
        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        // 这个函数简单的来讲就是检查wip的childLanes是否包含renderLanes
        // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        // 包含的话就直接让wip的child指向current的child的alternate（packages/react-reconciler/src/ReactChildFiber.new.js中的cloneChildFibers） // ++++++++++++++++++++++++++
        // 如果不包含的话那么直接返回的是一个null
        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      }
      if ((current.flags & ForceUpdateForLegacySuspense) !== NoFlags) {
        // This is a special case that only exists for legacy mode.
        // See https://github.com/facebook/react/pull/19216.
        didReceiveUpdate = true;
      } else {
        // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        // An update was scheduled on this fiber, but there are no new props
        // nor legacy context. Set this to false. If an update queue or context
        // consumer produces a changed value, it will set this to true. Otherwise,
        // the component will assume the children have not changed and bail out.
        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        didReceiveUpdate = false; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        // 这个变量在updateFunctionComponent函数中使用
        // 以及在renderWithHooks -> Component -> useState -> updateState -> updateReducer -> !is(newState, hook.memoizedState): markWorkInProgressReceivedUpdate -> 
        // didReceiveUpdate = true;来去做的 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

        /* 
        packages/react-reconciler/src/ReactFiberWorkLoop.new.js
        prepareFreshStack -> createWorkInProgress // ++++++++++++++++++++++++++++++++++++++++++++++++++++

        packages/react-reconciler/src/ReactFiber.new.js
        createWorkInProgress // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        */
      }
    }
  } else {
    didReceiveUpdate = false;

    if (getIsHydrating() && isForkedChild(workInProgress)) {
      // Check if this child belongs to a list of muliple children in
      // its parent.
      //
      // In a true multi-threaded implementation, we would render children on
      // parallel threads. This would represent the beginning of a new render
      // thread for this subtree.
      //
      // We only use this for id generation during hydration, which is why the
      // logic is located in this special branch.
      const slotIndex = workInProgress.index;
      const numberOfForks = getForksAtLevel(workInProgress);
      pushTreeId(workInProgress, numberOfForks, slotIndex);
    }
  }

  // Before entering the begin phase, clear pending update priority.
  // TODO: This assumes that we're about to evaluate the component and process
  // the update queue. However, there's an exception: SimpleMemoComponent
  // sometimes bails out later in the begin phase. This indicates that we should
  // move this assignment out of the common path and into each branch.

  // 注意！！！
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  workInProgress.lanes = NoLanes; // 把workInProgress fiber的lanes置为0 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  switch (workInProgress.tag) { // 标签
    case IndeterminateComponent: {
      return mountIndeterminateComponent( // 挂载不知道的组件 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        current,
        workInProgress,
        workInProgress.type,
        renderLanes,
      );

    }


    // +++
    case LazyComponent: {
      const elementType = workInProgress.elementType;
      /* 
      就是packages/react/src/ReactLazy.js中lazy函数中的
  // +++
  const lazyType: LazyComponent<T, Payload<T>> = {
    $$typeof: REACT_LAZY_TYPE, // +++
    _payload: payload, /// payload对象
    _init: lazyInitializer, // 懒初始化器函数 // +++
  };
      */

      // 挂载懒组件 // +++
      return mountLazyComponent(
        current,
        workInProgress,
        elementType,
        renderLanes,
      );
    }
    // App组件
    case FunctionComponent: { // 函数式组件
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);
      // 更新函数式组件 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      return updateFunctionComponent( // 更新函数式组件 //++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );

    }

    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // 类组件 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    case ClassComponent: { // +++
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);

      // 直接进行更新类组件 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      return updateClassComponent( // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
    }
    case HostRoot: // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

      return updateHostRoot(current, workInProgress, renderLanes); // ++++++++++++++++++++++++++++++++++++

    case HostResource:
      if (enableFloat && supportsResources) {
        return updateHostResource(current, workInProgress, renderLanes);
      }
    // eslint-disable-next-line no-fallthrough
    case HostSingleton:
      if (enableHostSingletons && supportsSingletons) {
        return updateHostSingleton(current, workInProgress, renderLanes);
      }
    // eslint-disable-next-line no-fallthrough
    case HostComponent: // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // button
      return updateHostComponent(current, workInProgress, renderLanes);

    case HostText: // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // 更新主机文本 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // 'count is '
      // 1
      // 这个函数中有这样一个注释：This is terminal. 
      // 这是终端 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      return updateHostText(current, workInProgress); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    // <Suspense> // +++
    case SuspenseComponent: // +++
      // +++
      // 更新suspense组件
      return updateSuspenseComponent(current, workInProgress, renderLanes); // +++

    // 主机portal // +++
    case HostPortal:
      // 更新portal组件 // +++
      return updatePortalComponent(current, workInProgress, renderLanes); // +++

    // 转发ref // +++
    case ForwardRef: {
      const type = workInProgress.type; // forwardRef函数里面准备的元素类型 // +++
      const unresolvedProps = workInProgress.pendingProps; // 组件上传入的属性对象 // +++
      const resolvedProps =
        workInProgress.elementType === type
          ? unresolvedProps
          : resolveDefaultProps(type, unresolvedProps);

      // 更新转发ref
      return updateForwardRef( // +++
        current,
        workInProgress,
        type, // 
        resolvedProps, // 
        renderLanes,
      );
    }
    // fragmnet
    case Fragment: // +++
      // 更新fragment // +++
      return updateFragment(current, workInProgress, renderLanes); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    case Mode:
      return updateMode(current, workInProgress, renderLanes);
    case Profiler:
      return updateProfiler(current, workInProgress, renderLanes);
    
    // +++
    case ContextProvider: // <XxxContext.Provider>
      return updateContextProvider(current, workInProgress, renderLanes); // 更新上下文提供者 +++
    
    // +++
    case ContextConsumer: // <XxxContext.Consumer>
      return updateContextConsumer(current, workInProgress, renderLanes); // 更新上下文消费者 +++
    
    // memo // +++
    case MemoComponent: { // +++
      const type = workInProgress.type; // memo函数里面准备的elementType对象 // +++

      const unresolvedProps = workInProgress.pendingProps;
      // Resolve outer props first, then resolve inner props.
      let resolvedProps = resolveDefaultProps(type, unresolvedProps);
      if (__DEV__) {
        if (workInProgress.type !== workInProgress.elementType) {
          const outerPropTypes = type.propTypes;
          if (outerPropTypes) {
            checkPropTypes(
              outerPropTypes,
              resolvedProps, // Resolved for outer only
              'prop',
              getComponentNameFromType(type),
            );
          }
        }
      }
      resolvedProps = resolveDefaultProps(type.type, resolvedProps);

      // 更新memo组件
      return updateMemoComponent(
        current,
        workInProgress,
        type, // memo函数里面准备的elementType对象
        resolvedProps,
        renderLanes,
      );
    }

    // +++重点 // +++
    // 简单memo组件 - 这里是更新的时候memo组件会走到这里的 // +++（因为在发现是简单memo组件时更改了memo组件对应的fiber的tag为简单memo组件啦 ~） // +++
    case SimpleMemoComponent: { // +++

      /// 更新简单memo组件 // +++
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        workInProgress.type,
        workInProgress.pendingProps,
        renderLanes,
      );
    }
    case IncompleteClassComponent: {
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps =
        workInProgress.elementType === Component
          ? unresolvedProps
          : resolveDefaultProps(Component, unresolvedProps);
      return mountIncompleteClassComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
    }
    case SuspenseListComponent: {
      return updateSuspenseListComponent(current, workInProgress, renderLanes);
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        return updateScopeComponent(current, workInProgress, renderLanes);
      }
      break;
    }

    // 离屏组件fiber // +++
    case OffscreenComponent: {
      // 更新画面以外组件 // +++
      return updateOffscreenComponent(current, workInProgress, renderLanes); // +++
    }
    case LegacyHiddenComponent: {
      if (enableLegacyHidden) {
        return updateLegacyHiddenComponent(
          current,
          workInProgress,
          renderLanes,
        );
      }
      break;
    }
    case CacheComponent: {
      if (enableCache) {
        return updateCacheComponent(current, workInProgress, renderLanes);
      }
      break;
    }
    case TracingMarkerComponent: {
      if (enableTransitionTracing) {
        return updateTracingMarkerComponent(
          current,
          workInProgress,
          renderLanes,
        );
      }
      break;
    }
  }

  throw new Error(
    `Unknown unit of work tag (${workInProgress.tag}). This error is likely caused by a bug in ` +
      'React. Please file an issue.',
  );
}

// 暴露此beginWork函数
export {beginWork}; // +++++++++++++++++++++++++++++++++++++++++++++
