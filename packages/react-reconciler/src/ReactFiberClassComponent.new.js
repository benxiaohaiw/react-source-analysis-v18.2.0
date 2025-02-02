/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane.new';
import type {UpdateQueue} from './ReactFiberClassUpdateQueue.new';
import type {Flags} from './ReactFiberFlags';

import * as React from 'react';
import {
  LayoutStatic,
  Update,
  Snapshot,
  MountLayoutDev,
} from './ReactFiberFlags';
import {
  debugRenderPhaseSideEffectsForStrictMode,
  disableLegacyContext,
  enableDebugTracing,
  enableSchedulingProfiler,
  warnAboutDeprecatedLifecycles,
  enableLazyContextPropagation,
} from 'shared/ReactFeatureFlags';
import ReactStrictModeWarnings from './ReactStrictModeWarnings.new';
import {isMounted} from './ReactFiberTreeReflection';
import {get as getInstance, set as setInstance} from 'shared/ReactInstanceMap';
import shallowEqual from 'shared/shallowEqual';
import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import getComponentNameFromType from 'shared/getComponentNameFromType';
import assign from 'shared/assign';
import isArray from 'shared/isArray';
import {REACT_CONTEXT_TYPE, REACT_PROVIDER_TYPE} from 'shared/ReactSymbols';

import {resolveDefaultProps} from './ReactFiberLazyComponent.new';
import {
  DebugTracingMode,
  NoMode,
  StrictLegacyMode,
  StrictEffectsMode,
} from './ReactTypeOfMode';

import {
  enqueueUpdate,
  entangleTransitions,
  processUpdateQueue,
  checkHasForceUpdateAfterProcessing,
  resetHasForceUpdateBeforeProcessing,
  createUpdate,
  ReplaceState,
  ForceUpdate,
  initializeUpdateQueue,
  cloneUpdateQueue,
} from './ReactFiberClassUpdateQueue.new';
import {NoLanes} from './ReactFiberLane.new';
import {
  cacheContext,
  getMaskedContext,
  getUnmaskedContext,
  hasContextChanged,
  emptyContextObject,
} from './ReactFiberContext.new';
import {readContext, checkIfContextChanged} from './ReactFiberNewContext.new';
import {
  requestEventTime,
  requestUpdateLane,
  scheduleUpdateOnFiber,
} from './ReactFiberWorkLoop.new';
import {logForceUpdateScheduled, logStateUpdateScheduled} from './DebugTracing';
import {
  markForceUpdateScheduled,
  markStateUpdateScheduled,
  setIsStrictModeForDevtools,
} from './ReactFiberDevToolsHook.new';

const fakeInternalInstance = {};

// React.Component uses a shared frozen object by default.
// We'll use it to determine whether we need to initialize legacy refs.
export const emptyRefsObject: $FlowFixMe = React.Component
  ? new React.Component().refs
  : {};

let didWarnAboutStateAssignmentForComponent;
let didWarnAboutUninitializedState;
let didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate;
let didWarnAboutLegacyLifecyclesAndDerivedState;
let didWarnAboutUndefinedDerivedState;
let warnOnUndefinedDerivedState;
let warnOnInvalidCallback;
let didWarnAboutDirectlyAssigningPropsToState;
let didWarnAboutContextTypeAndContextTypes;
let didWarnAboutInvalidateContextType;

if (__DEV__) {
  didWarnAboutStateAssignmentForComponent = new Set();
  didWarnAboutUninitializedState = new Set();
  didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate = new Set();
  didWarnAboutLegacyLifecyclesAndDerivedState = new Set();
  didWarnAboutDirectlyAssigningPropsToState = new Set();
  didWarnAboutUndefinedDerivedState = new Set();
  didWarnAboutContextTypeAndContextTypes = new Set();
  didWarnAboutInvalidateContextType = new Set();

  const didWarnOnInvalidCallback = new Set();

  warnOnInvalidCallback = function(callback: mixed, callerName: string) {
    if (callback === null || typeof callback === 'function') {
      return;
    }
    const key = callerName + '_' + (callback: any);
    if (!didWarnOnInvalidCallback.has(key)) {
      didWarnOnInvalidCallback.add(key);
      console.error(
        '%s(...): Expected the last optional `callback` argument to be a ' +
          'function. Instead received: %s.',
        callerName,
        callback,
      );
    }
  };

  warnOnUndefinedDerivedState = function(type, partialState) {
    if (partialState === undefined) {
      const componentName = getComponentNameFromType(type) || 'Component';
      if (!didWarnAboutUndefinedDerivedState.has(componentName)) {
        didWarnAboutUndefinedDerivedState.add(componentName);
        console.error(
          '%s.getDerivedStateFromProps(): A valid state object (or null) must be returned. ' +
            'You have returned undefined.',
          componentName,
        );
      }
    }
  };

  // This is so gross but it's at least non-critical and can be removed if
  // it causes problems. This is meant to give a nicer error message for
  // ReactDOM15.unstable_renderSubtreeIntoContainer(reactDOM16Component,
  // ...)) which otherwise throws a "_processChildContext is not a function"
  // exception.
  Object.defineProperty(fakeInternalInstance, '_processChildContext', {
    enumerable: false,
    value: function() {
      throw new Error(
        '_processChildContext is not available in React 16+. This likely ' +
          'means you have multiple copies of React and are attempting to nest ' +
          'a React 15 tree inside a React 16 tree using ' +
          "unstable_renderSubtreeIntoContainer, which isn't supported. Try " +
          'to make sure you have only one copy of React (and ideally, switch ' +
          'to ReactDOM.createPortal).',
      );
    },
  });
  Object.freeze(fakeInternalInstance);
}

function applyDerivedStateFromProps(
  workInProgress: Fiber,
  ctor: any,
  getDerivedStateFromProps: (props: any, state: any) => any,
  nextProps: any,
) {
  const prevState = workInProgress.memoizedState;
  let partialState = getDerivedStateFromProps(nextProps, prevState);
  if (__DEV__) {
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictLegacyMode
    ) {
      setIsStrictModeForDevtools(true);
      try {
        // Invoke the function an extra time to help detect side-effects.
        partialState = getDerivedStateFromProps(nextProps, prevState);
      } finally {
        setIsStrictModeForDevtools(false);
      }
    }
    warnOnUndefinedDerivedState(ctor, partialState);
  }
  // Merge the partial state and the previous state.
  const memoizedState =
    partialState === null || partialState === undefined
      ? prevState
      : assign({}, prevState, partialState);
  workInProgress.memoizedState = memoizedState;

  // Once the update queue is empty, persist the derived state onto the
  // base state.
  if (workInProgress.lanes === NoLanes) {
    // Queue is always non-null for classes
    const updateQueue: UpdateQueue<any> = (workInProgress.updateQueue: any);
    updateQueue.baseState = memoizedState;
  }
}

// 类组件更新器 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
const classComponentUpdater = {
  isMounted, // 是否已挂载 // +++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  enqueueSetState(inst, payload, callback) { // 组件实例 对象 函数
    const fiber = getInstance(inst); // 获取组件实例对应的fiber对象
    const eventTime = requestEventTime();
    const lane = requestUpdateLane(fiber); // 请求更新车道
    /* 
    在react下的click，那么这个lane就是为1 同步车道
    脱离react比如setTimeout，那么这个lane为16 默认
    */

    const update = createUpdate(eventTime, lane); // 创建更新update对象
    // 通过此函数创建的update对象它的tag为UpdateState // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    update.payload = payload; // 存放在update对象上

    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'setState');
      }
      update.callback = callback; // 同样也是存在update对象上
    }

    // 入队列更新 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // ./ReactFiberClassUpdateQueue.new.js（enqueueUpdate -> enqueueConcurrentClassUpdate（./ReactFiberConcurrentUpdates.new.js））
    const root = enqueueUpdate(fiber, update, lane);
    // 其实就是把update对象形成一个环形链表，然后把它挂载到fiber.updateQueue.shared.pending属性上 // ++++++++++++++++++++
    // 返回FiberRootNode

    if (root !== null) {
      // 在fiber上进行调度更新 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      scheduleUpdateOnFiber(root, fiber, lane, eventTime); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      entangleTransitions(root, fiber, lane);
    }

    if (__DEV__) {
      if (enableDebugTracing) {
        if (fiber.mode & DebugTracingMode) {
          const name = getComponentNameFromFiber(fiber) || 'Unknown';
          logStateUpdateScheduled(name, lane, payload);
        }
      }
    }

    if (enableSchedulingProfiler) {
      markStateUpdateScheduled(fiber, lane);
    }
  },
  enqueueReplaceState(inst, payload, callback) {
    const fiber = getInstance(inst);
    const eventTime = requestEventTime();
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(eventTime, lane);
    update.tag = ReplaceState;
    update.payload = payload;

    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'replaceState');
      }
      update.callback = callback;
    }

    const root = enqueueUpdate(fiber, update, lane);
    if (root !== null) {
      scheduleUpdateOnFiber(root, fiber, lane, eventTime);
      entangleTransitions(root, fiber, lane);
    }

    if (__DEV__) {
      if (enableDebugTracing) {
        if (fiber.mode & DebugTracingMode) {
          const name = getComponentNameFromFiber(fiber) || 'Unknown';
          logStateUpdateScheduled(name, lane, payload);
        }
      }
    }

    if (enableSchedulingProfiler) {
      markStateUpdateScheduled(fiber, lane);
    }
  },
  enqueueForceUpdate(inst, callback) {
    const fiber = getInstance(inst);
    const eventTime = requestEventTime();
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(eventTime, lane);
    update.tag = ForceUpdate;

    if (callback !== undefined && callback !== null) {
      if (__DEV__) {
        warnOnInvalidCallback(callback, 'forceUpdate');
      }
      update.callback = callback;
    }

    const root = enqueueUpdate(fiber, update, lane);
    if (root !== null) {
      scheduleUpdateOnFiber(root, fiber, lane, eventTime);
      entangleTransitions(root, fiber, lane);
    }

    if (__DEV__) {
      if (enableDebugTracing) {
        if (fiber.mode & DebugTracingMode) {
          const name = getComponentNameFromFiber(fiber) || 'Unknown';
          logForceUpdateScheduled(name, lane);
        }
      }
    }

    if (enableSchedulingProfiler) {
      markForceUpdateScheduled(fiber, lane);
    }
  },
};

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function checkShouldComponentUpdate( // 检查是否应该组件更新 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++
  workInProgress,
  ctor,
  oldProps,
  newProps,
  oldState,
  newState,
  nextContext,
) {
  const instance = workInProgress.stateNode;
  if (typeof instance.shouldComponentUpdate === 'function') {
    let shouldUpdate = instance.shouldComponentUpdate(
      newProps,
      newState,
      nextContext,
    );
    if (__DEV__) {
      if (
        debugRenderPhaseSideEffectsForStrictMode &&
        workInProgress.mode & StrictLegacyMode
      ) {
        setIsStrictModeForDevtools(true);
        try {
          // Invoke the function an extra time to help detect side-effects.
          shouldUpdate = instance.shouldComponentUpdate(
            newProps,
            newState,
            nextContext,
          );
        } finally {
          setIsStrictModeForDevtools(false);
        }
      }
      if (shouldUpdate === undefined) {
        console.error(
          '%s.shouldComponentUpdate(): Returned undefined instead of a ' +
            'boolean value. Make sure to return true or false.',
          getComponentNameFromType(ctor) || 'Component',
        );
      }
    }

    return shouldUpdate;
  }

  // 取出原型上面的isPureReactComponent标记 - 是说明extends PureComponent // +++
  if (ctor.prototype && ctor.prototype.isPureReactComponent) {

    // memo函数和PureComponent区别
    // PureComponent多了一个state比较 // +++

    // 返回的是 !属性浅比较 || !状态state浅比较 // +++
    /// 它的true or false将影响到updateClassInstance -> updateClassComponent -> finishClassComponent -> !shouldUpdate（不应该进行更新） -> bailoutOnAlreadyFinishedWork（尽早的返回）
    return (
      // shared/shallowEqual // +++
      !shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState)
    );
  }

  return true;
}

// 对类实例进行检查
function checkClassInstance(workInProgress: Fiber, ctor: any, newProps: any) {
  const instance = workInProgress.stateNode;
  if (__DEV__) {
    const name = getComponentNameFromType(ctor) || 'Component';
    const renderPresent = instance.render;

    if (!renderPresent) {
      if (ctor.prototype && typeof ctor.prototype.render === 'function') {
        console.error(
          '%s(...): No `render` method found on the returned component ' +
            'instance: did you accidentally return an object from the constructor?',
          name,
        );
      } else {
        console.error(
          '%s(...): No `render` method found on the returned component ' +
            'instance: you may have forgotten to define `render`.',
          name,
        );
      }
    }

    if (
      instance.getInitialState &&
      !instance.getInitialState.isReactClassApproved &&
      !instance.state
    ) {
      console.error(
        'getInitialState was defined on %s, a plain JavaScript class. ' +
          'This is only supported for classes created using React.createClass. ' +
          'Did you mean to define a state property instead?',
        name,
      );
    }
    if (
      instance.getDefaultProps &&
      !instance.getDefaultProps.isReactClassApproved
    ) {
      console.error(
        'getDefaultProps was defined on %s, a plain JavaScript class. ' +
          'This is only supported for classes created using React.createClass. ' +
          'Use a static property to define defaultProps instead.',
        name,
      );
    }
    if (instance.propTypes) {
      console.error(
        'propTypes was defined as an instance property on %s. Use a static ' +
          'property to define propTypes instead.',
        name,
      );
    }
    if (instance.contextType) {
      console.error(
        'contextType was defined as an instance property on %s. Use a static ' +
          'property to define contextType instead.',
        name,
      );
    }

    if (disableLegacyContext) {
      if (ctor.childContextTypes) {
        console.error(
          '%s uses the legacy childContextTypes API which is no longer supported. ' +
            'Use React.createContext() instead.',
          name,
        );
      }
      if (ctor.contextTypes) {
        console.error(
          '%s uses the legacy contextTypes API which is no longer supported. ' +
            'Use React.createContext() with static contextType instead.',
          name,
        );
      }
    } else {
      if (instance.contextTypes) {
        console.error(
          'contextTypes was defined as an instance property on %s. Use a static ' +
            'property to define contextTypes instead.',
          name,
        );
      }

      if (
        ctor.contextType &&
        ctor.contextTypes &&
        !didWarnAboutContextTypeAndContextTypes.has(ctor)
      ) {
        didWarnAboutContextTypeAndContextTypes.add(ctor);
        console.error(
          '%s declares both contextTypes and contextType static properties. ' +
            'The legacy contextTypes property will be ignored.',
          name,
        );
      }
    }

    if (typeof instance.componentShouldUpdate === 'function') {
      console.error(
        '%s has a method called ' +
          'componentShouldUpdate(). Did you mean shouldComponentUpdate()? ' +
          'The name is phrased as a question because the function is ' +
          'expected to return a value.',
        name,
      );
    }
    if (
      ctor.prototype &&
      ctor.prototype.isPureReactComponent &&
      typeof instance.shouldComponentUpdate !== 'undefined'
    ) {
      console.error(
        '%s has a method called shouldComponentUpdate(). ' +
          'shouldComponentUpdate should not be used when extending React.PureComponent. ' +
          'Please extend React.Component if shouldComponentUpdate is used.',
        getComponentNameFromType(ctor) || 'A pure component',
      );
    }
    if (typeof instance.componentDidUnmount === 'function') {
      console.error(
        '%s has a method called ' +
          'componentDidUnmount(). But there is no such lifecycle method. ' +
          'Did you mean componentWillUnmount()?',
        name,
      );
    }
    if (typeof instance.componentDidReceiveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'componentDidReceiveProps(). But there is no such lifecycle method. ' +
          'If you meant to update the state in response to changing props, ' +
          'use componentWillReceiveProps(). If you meant to fetch data or ' +
          'run side-effects or mutations after React has updated the UI, use componentDidUpdate().',
        name,
      );
    }
    if (typeof instance.componentWillRecieveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'componentWillRecieveProps(). Did you mean componentWillReceiveProps()?',
        name,
      );
    }
    if (typeof instance.UNSAFE_componentWillRecieveProps === 'function') {
      console.error(
        '%s has a method called ' +
          'UNSAFE_componentWillRecieveProps(). Did you mean UNSAFE_componentWillReceiveProps()?',
        name,
      );
    }
    const hasMutatedProps = instance.props !== newProps;
    if (instance.props !== undefined && hasMutatedProps) {
      console.error(
        '%s(...): When calling super() in `%s`, make sure to pass ' +
          "up the same props that your component's constructor was passed.",
        name,
        name,
      );
    }
    if (instance.defaultProps) {
      console.error(
        'Setting defaultProps as an instance property on %s is not supported and will be ignored.' +
          ' Instead, define defaultProps as a static property on %s.',
        name,
        name,
      );
    }

    if (
      typeof instance.getSnapshotBeforeUpdate === 'function' &&
      typeof instance.componentDidUpdate !== 'function' &&
      !didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.has(ctor)
    ) {
      didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.add(ctor);
      console.error(
        '%s: getSnapshotBeforeUpdate() should be used with componentDidUpdate(). ' +
          'This component defines getSnapshotBeforeUpdate() only.',
        getComponentNameFromType(ctor),
      );
    }

    if (typeof instance.getDerivedStateFromProps === 'function') {
      console.error(
        '%s: getDerivedStateFromProps() is defined as an instance method ' +
          'and will be ignored. Instead, declare it as a static method.',
        name,
      );
    }
    if (typeof instance.getDerivedStateFromError === 'function') {
      console.error(
        '%s: getDerivedStateFromError() is defined as an instance method ' +
          'and will be ignored. Instead, declare it as a static method.',
        name,
      );
    }
    if (typeof ctor.getSnapshotBeforeUpdate === 'function') {
      console.error(
        '%s: getSnapshotBeforeUpdate() is defined as a static method ' +
          'and will be ignored. Instead, declare it as an instance method.',
        name,
      );
    }
    const state = instance.state;
    if (state && (typeof state !== 'object' || isArray(state))) {
      console.error('%s.state: must be set to an object or null', name);
    }
    if (
      typeof instance.getChildContext === 'function' &&
      typeof ctor.childContextTypes !== 'object'
    ) {
      console.error(
        '%s.getChildContext(): childContextTypes must be defined in order to ' +
          'use getChildContext().',
        name,
      );
    }
  }
}

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function adoptClassInstance(workInProgress: Fiber, instance: any): void {
  // 替换实例的更新器
  instance.updater = classComponentUpdater;
  // 让fiber的stateNode存储该实例
  workInProgress.stateNode = instance;

  // 实例需要访问fiber，以便它可以调度更新
  // The instance needs access to the fiber so that it can schedule updates
  setInstance(instance, workInProgress);


  if (__DEV__) {
    instance._reactInternalInstance = fakeInternalInstance;
  }
}

// 1.构造类实例 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function constructClassInstance(
  workInProgress: Fiber,
  ctor: any,
  props: any,
): any {
  let isLegacyContextConsumer = false;
  let unmaskedContext = emptyContextObject;
  let context = emptyContextObject;
  const contextType = ctor.contextType;

  if (__DEV__) {
    if ('contextType' in ctor) {
      const isValid =
        // Allow null for conditional declaration
        contextType === null ||
        (contextType !== undefined &&
          contextType.$$typeof === REACT_CONTEXT_TYPE &&
          contextType._context === undefined); // Not a <Context.Consumer>

      if (!isValid && !didWarnAboutInvalidateContextType.has(ctor)) {
        didWarnAboutInvalidateContextType.add(ctor);

        let addendum = '';
        if (contextType === undefined) {
          addendum =
            ' However, it is set to undefined. ' +
            'This can be caused by a typo or by mixing up named and default imports. ' +
            'This can also happen due to a circular dependency, so ' +
            'try moving the createContext() call to a separate file.';
        } else if (typeof contextType !== 'object') {
          addendum = ' However, it is set to a ' + typeof contextType + '.';
        } else if (contextType.$$typeof === REACT_PROVIDER_TYPE) {
          addendum = ' Did you accidentally pass the Context.Provider instead?';
        } else if (contextType._context !== undefined) {
          // <Context.Consumer>
          addendum = ' Did you accidentally pass the Context.Consumer instead?';
        } else {
          addendum =
            ' However, it is set to an object with keys {' +
            Object.keys(contextType).join(', ') +
            '}.';
        }
        console.error(
          '%s defines an invalid contextType. ' +
            'contextType should point to the Context object returned by React.createContext().%s',
          getComponentNameFromType(ctor) || 'Component',
          addendum,
        );
      }
    }
  }

  if (typeof contextType === 'object' && contextType !== null) {
    context = readContext((contextType: any));
  } else if (!disableLegacyContext) {
    unmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    const contextTypes = ctor.contextTypes;
    isLegacyContextConsumer =
      contextTypes !== null && contextTypes !== undefined;
    context = isLegacyContextConsumer
      ? getMaskedContext(workInProgress, unmaskedContext)
      : emptyContextObject;
  }

  // 创建组件类实例
  let instance = new ctor(props, context); // +++++++++++++++++++++++++++++++++++++++++++++++


  // Instantiate twice to help detect side-effects.
  if (__DEV__) {
    if (
      debugRenderPhaseSideEffectsForStrictMode &&
      workInProgress.mode & StrictLegacyMode
    ) {
      setIsStrictModeForDevtools(true);
      try {
        instance = new ctor(props, context); // eslint-disable-line no-new
      } finally {
        setIsStrictModeForDevtools(false);
      }
    }
  }

  // 实例身上的state属性
  const state = (workInProgress.memoizedState =
    instance.state !== null && instance.state !== undefined
      ? instance.state
      : null);

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  adoptClassInstance(workInProgress, instance);
  /* 
    // 替换实例的更新器
  instance.updater = classComponentUpdater; // 替换实例上的更新器 // ++++++++++++++++++++++++++
  // 让fiber的stateNode存储该实例
  workInProgress.stateNode = instance;

  // 实例需要访问fiber，以便它可以调度更新
  // The instance needs access to the fiber so that it can schedule updates
  setInstance(instance, workInProgress);
  */
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  if (__DEV__) {
    if (typeof ctor.getDerivedStateFromProps === 'function' && state === null) {
      const componentName = getComponentNameFromType(ctor) || 'Component';
      if (!didWarnAboutUninitializedState.has(componentName)) {
        didWarnAboutUninitializedState.add(componentName);
        console.error(
          '`%s` uses `getDerivedStateFromProps` but its initial state is ' +
            '%s. This is not recommended. Instead, define the initial state by ' +
            'assigning an object to `this.state` in the constructor of `%s`. ' +
            'This ensures that `getDerivedStateFromProps` arguments have a consistent shape.',
          componentName,
          instance.state === null ? 'null' : 'undefined',
          componentName,
        );
      }
    }

    // If new component APIs are defined, "unsafe" lifecycles won't be called.
    // Warn about these lifecycles if they are present.
    // Don't warn about react-lifecycles-compat polyfilled methods though.
    if (
      typeof ctor.getDerivedStateFromProps === 'function' ||
      typeof instance.getSnapshotBeforeUpdate === 'function'
    ) {
      let foundWillMountName = null;
      let foundWillReceivePropsName = null;
      let foundWillUpdateName = null;
      if (
        typeof instance.componentWillMount === 'function' &&
        instance.componentWillMount.__suppressDeprecationWarning !== true
      ) {
        foundWillMountName = 'componentWillMount';
      } else if (typeof instance.UNSAFE_componentWillMount === 'function') {
        foundWillMountName = 'UNSAFE_componentWillMount';
      }
      if (
        typeof instance.componentWillReceiveProps === 'function' &&
        instance.componentWillReceiveProps.__suppressDeprecationWarning !== true
      ) {
        foundWillReceivePropsName = 'componentWillReceiveProps';
      } else if (
        typeof instance.UNSAFE_componentWillReceiveProps === 'function'
      ) {
        foundWillReceivePropsName = 'UNSAFE_componentWillReceiveProps';
      }
      if (
        typeof instance.componentWillUpdate === 'function' &&
        instance.componentWillUpdate.__suppressDeprecationWarning !== true
      ) {
        foundWillUpdateName = 'componentWillUpdate';
      } else if (typeof instance.UNSAFE_componentWillUpdate === 'function') {
        foundWillUpdateName = 'UNSAFE_componentWillUpdate';
      }
      if (
        foundWillMountName !== null ||
        foundWillReceivePropsName !== null ||
        foundWillUpdateName !== null
      ) {
        const componentName = getComponentNameFromType(ctor) || 'Component';
        const newApiName =
          typeof ctor.getDerivedStateFromProps === 'function'
            ? 'getDerivedStateFromProps()'
            : 'getSnapshotBeforeUpdate()';
        if (!didWarnAboutLegacyLifecyclesAndDerivedState.has(componentName)) {
          didWarnAboutLegacyLifecyclesAndDerivedState.add(componentName);
          console.error(
            'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
              '%s uses %s but also contains the following legacy lifecycles:%s%s%s\n\n' +
              'The above lifecycles should be removed. Learn more about this warning here:\n' +
              'https://reactjs.org/link/unsafe-component-lifecycles',
            componentName,
            newApiName,
            foundWillMountName !== null ? `\n  ${foundWillMountName}` : '',
            foundWillReceivePropsName !== null
              ? `\n  ${foundWillReceivePropsName}`
              : '',
            foundWillUpdateName !== null ? `\n  ${foundWillUpdateName}` : '',
          );
        }
      }
    }
  }

  // Cache unmasked context so we can avoid recreating masked context unless necessary.
  // ReactFiberContext usually updates this cache but can't for newly-created instances.
  if (isLegacyContextConsumer) {
    cacheContext(workInProgress, unmaskedContext, context);
  }

  return instance;
}

function callComponentWillMount(workInProgress, instance) {
  const oldState = instance.state;

  if (typeof instance.componentWillMount === 'function') {
    instance.componentWillMount();
  }
  if (typeof instance.UNSAFE_componentWillMount === 'function') {
    instance.UNSAFE_componentWillMount();
  }

  if (oldState !== instance.state) {
    if (__DEV__) {
      console.error(
        '%s.componentWillMount(): Assigning directly to this.state is ' +
          "deprecated (except inside a component's " +
          'constructor). Use setState instead.',
        getComponentNameFromFiber(workInProgress) || 'Component',
      );
    }
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

function callComponentWillReceiveProps(
  workInProgress,
  instance,
  newProps,
  nextContext,
) {
  const oldState = instance.state;
  if (typeof instance.componentWillReceiveProps === 'function') {
    instance.componentWillReceiveProps(newProps, nextContext);
  }
  if (typeof instance.UNSAFE_componentWillReceiveProps === 'function') {
    instance.UNSAFE_componentWillReceiveProps(newProps, nextContext);
  }

  if (instance.state !== oldState) {
    if (__DEV__) {
      const componentName =
        getComponentNameFromFiber(workInProgress) || 'Component';
      if (!didWarnAboutStateAssignmentForComponent.has(componentName)) {
        didWarnAboutStateAssignmentForComponent.add(componentName);
        console.error(
          '%s.componentWillReceiveProps(): Assigning directly to ' +
            "this.state is deprecated (except inside a component's " +
            'constructor). Use setState instead.',
          componentName,
        );
      }
    }
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

/* 
packages/react-reconciler/src/ReactFiberBeginWork.new.js
render阶段：beginWork -> updateClassComponent -> mountClassInstance
*/
// 2.挂载类实例 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// 在以前从未渲染过的实例上调用挂载生命周期。
// Invokes the mount life-cycles on a previously never rendered instance.
function mountClassInstance(
  workInProgress: Fiber,
  ctor: any,
  newProps: any,
  renderLanes: Lanes,
): void {
  if (__DEV__) {
    checkClassInstance(workInProgress, ctor, newProps);
  }

  const instance = workInProgress.stateNode; // 取出对应的类组件实例
  instance.props = newProps;
  instance.state = workInProgress.memoizedState;
  instance.refs = emptyRefsObject;

  // 初始化updateQueue // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  initializeUpdateQueue(workInProgress); // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  /* 
  // packages/react-reconciler/src/ReactFiberClassUpdateQueue.new.js

  // 初始化更新队列 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export function initializeUpdateQueue<State>(fiber: Fiber): void {
  const queue: UpdateQueue<State> = {
    baseState: fiber.memoizedState, // 把fiber的上一次状态属性值存入更新队列的基础状态属性上
    firstBaseUpdate: null,
    lastBaseUpdate: null,
    shared: { // 共享
      pending: null,
      lanes: NoLanes, // 0
      hiddenCallbacks: null,
    },
    callbacks: null,
  };
  // 挂载到fiber的updateQueue属性上
  fiber.updateQueue = queue;
}
  */

  const contextType = ctor.contextType;
  if (typeof contextType === 'object' && contextType !== null) {
    
    // 读取上下文 // +++
    instance.context = readContext(contextType); // +++

  } else if (disableLegacyContext) {
    instance.context = emptyContextObject;
  } else {
    const unmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    instance.context = getMaskedContext(workInProgress, unmaskedContext);
  }

  if (__DEV__) {
    if (instance.state === newProps) {
      const componentName = getComponentNameFromType(ctor) || 'Component';
      if (!didWarnAboutDirectlyAssigningPropsToState.has(componentName)) {
        didWarnAboutDirectlyAssigningPropsToState.add(componentName);
        console.error(
          '%s: It is not recommended to assign props directly to state ' +
            "because updates to props won't be reflected in state. " +
            'In most cases, it is better to use props directly.',
          componentName,
        );
      }
    }

    if (workInProgress.mode & StrictLegacyMode) {
      ReactStrictModeWarnings.recordLegacyContextWarning(
        workInProgress,
        instance,
      );
    }

    if (warnAboutDeprecatedLifecycles) {
      ReactStrictModeWarnings.recordUnsafeLifecycleWarnings(
        workInProgress,
        instance,
      );
    }
  }

  instance.state = workInProgress.memoizedState;

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps; // 类组件的静态方法
  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps( // 【执行】类的getDerivedStateFromProps生命周期函数
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    instance.state = workInProgress.memoizedState;
  }

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  if (
    typeof ctor.getDerivedStateFromProps !== 'function' &&
    typeof instance.getSnapshotBeforeUpdate !== 'function' &&
    (typeof instance.UNSAFE_componentWillMount === 'function' ||
      typeof instance.componentWillMount === 'function')
  ) {
    // 【执行】实例的componentWillMount、UNSAFE_componentWillMount生命周期函数（前提是类的getDerivedStateFromProps没有且实例的getSnapshotBeforeUpdate也没有）
    callComponentWillMount(workInProgress, instance); // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // If we had additional state updates during this life-cycle, let's
    // process them now.
    processUpdateQueue(workInProgress, newProps, instance, renderLanes); // +++++++++++++++++++++++++++++++++++++++
    instance.state = workInProgress.memoizedState; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }


  // 对于实例的componentDidMount生命周期函数在workInProgress的flags上加上Update | LayoutStatic这个标记
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  if (typeof instance.componentDidMount === 'function') { // ++++++++++++++++++++++++++++++++++++++++++++++++++++++
    let fiberFlags: Flags = Update | LayoutStatic; // ++++++++++++++++++++++++++++++++
    if (__DEV__ && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
      fiberFlags |= MountLayoutDev; // +++++++++++++++++++++++++++++++++++++++++++++++
    }
    workInProgress.flags |= fiberFlags; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

}

// 恢复挂载类实例 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function resumeMountClassInstance(
  workInProgress: Fiber,
  ctor: any,
  newProps: any,
  renderLanes: Lanes,
): boolean {
  const instance = workInProgress.stateNode;

  const oldProps = workInProgress.memoizedProps;
  instance.props = oldProps;

  const oldContext = instance.context;
  const contextType = ctor.contextType;
  let nextContext = emptyContextObject;
  if (typeof contextType === 'object' && contextType !== null) {
    nextContext = readContext(contextType);
  } else if (!disableLegacyContext) {
    const nextLegacyUnmaskedContext = getUnmaskedContext(
      workInProgress,
      ctor,
      true,
    );
    nextContext = getMaskedContext(workInProgress, nextLegacyUnmaskedContext);
  }

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === 'function' ||
    typeof instance.getSnapshotBeforeUpdate === 'function';

  // Note: During these life-cycles, instance.props/instance.state are what
  // ever the previously attempted to render - not the "current". However,
  // during componentDidUpdate we pass the "current" props.

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
      typeof instance.componentWillReceiveProps === 'function')
  ) {
    if (oldProps !== newProps || oldContext !== nextContext) {
      callComponentWillReceiveProps(
        workInProgress,
        instance,
        newProps,
        nextContext,
      );
    }
  }

  resetHasForceUpdateBeforeProcessing();

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  processUpdateQueue(workInProgress, newProps, instance, renderLanes);
  newState = workInProgress.memoizedState;
  if (
    oldProps === newProps &&
    oldState === newState &&
    !hasContextChanged() &&
    !checkHasForceUpdateAfterProcessing()
  ) {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidMount === 'function') {
      let fiberFlags: Flags = Update | LayoutStatic;
      if (__DEV__ && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
        fiberFlags |= MountLayoutDev;
      }
      workInProgress.flags |= fiberFlags;
    }
    return false;
  }

  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps(
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    newState = workInProgress.memoizedState;
  }

  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||
    checkShouldComponentUpdate(
      workInProgress,
      ctor,
      oldProps,
      newProps,
      oldState,
      newState,
      nextContext,
    );

  if (shouldUpdate) {
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillMount === 'function' ||
        typeof instance.componentWillMount === 'function')
    ) {
      if (typeof instance.componentWillMount === 'function') {
        instance.componentWillMount();
      }
      if (typeof instance.UNSAFE_componentWillMount === 'function') {
        instance.UNSAFE_componentWillMount();
      }
    }
    if (typeof instance.componentDidMount === 'function') {
      let fiberFlags: Flags = Update | LayoutStatic;
      if (__DEV__ && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
        fiberFlags |= MountLayoutDev;
      }
      workInProgress.flags |= fiberFlags;
    }
  } else {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidMount === 'function') {
      let fiberFlags: Flags = Update | LayoutStatic;
      if (__DEV__ && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
        fiberFlags |= MountLayoutDev;
      }
      workInProgress.flags |= fiberFlags;
    }

    // If shouldComponentUpdate returned false, we should still update the
    // memoized state to indicate that this work can be reused.
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
  }

  // Update the existing instance's state, props, and context pointers even
  // if shouldComponentUpdate returns false.
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;

  return shouldUpdate;
}


/* 
https://www.yuque.com/benxiaohaiw/kvmb3r/zygh06#hZbqv

commit阶段
在commitRootImpl下
  commitBeforeMutationEffects
  // 在commitBeforeMutationEffects里面【执行】类组件实例的getSnapshotBeforeUpdate生命周期函数（同步执行的）

  commitMutationEffects

  commitLayoutEffects
  类组件实例对应的fiber workInProgress <-> current === null ? 在commitLayoutEffects里面【执行】类组件实例的componentDidMount生命周期函数（同步执行的）
    : 在commitLayoutEffects里面【执行】类组件实例的componentDidUpdate生命周期函数（同步执行的）

  在commitLayoutEffects里面【执行】setState api的第二个参数函数（同步执行的）
*/


/* 
packages/react-reconciler/src/ReactFiberBeginWork.new.js
render阶段：beginWork -> updateClassComponent -> updateClassInstance
*/
// 更新类实例 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// Invokes the update life-cycles and returns false if it shouldn't rerender.
function updateClassInstance(
  current: Fiber,
  workInProgress: Fiber,
  ctor: any,
  newProps: any,
  renderLanes: Lanes,
): boolean {
  const instance = workInProgress.stateNode; // 类组件实例 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 克隆updateQueue - 【浅克隆】
  cloneUpdateQueue(current, workInProgress);
  // 就是把current的updateQueue克隆到wip的updateQueue上，注意这是一个【浅克隆】 // ++++++++++++++++++++++++++++++++++++++


  const unresolvedOldProps = workInProgress.memoizedProps;
  const oldProps =
    workInProgress.type === workInProgress.elementType
      ? unresolvedOldProps
      : resolveDefaultProps(workInProgress.type, unresolvedOldProps);
  instance.props = oldProps;
  const unresolvedNewProps = workInProgress.pendingProps;

  const oldContext = instance.context;
  const contextType = ctor.contextType;
  let nextContext = emptyContextObject;
  if (typeof contextType === 'object' && contextType !== null) {


    // 读取上下文 // +++
    nextContext = readContext(contextType); // +++


  } else if (!disableLegacyContext) {
    const nextUnmaskedContext = getUnmaskedContext(workInProgress, ctor, true);
    nextContext = getMaskedContext(workInProgress, nextUnmaskedContext);
  }

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === 'function' ||
    typeof instance.getSnapshotBeforeUpdate === 'function';

  // Note: During these life-cycles, instance.props/instance.state are what
  // ever the previously attempted to render - not the "current". However,
  // during componentDidUpdate we pass the "current" props.

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === 'function' ||
      typeof instance.componentWillReceiveProps === 'function')
  ) {
    if (
      unresolvedOldProps !== unresolvedNewProps ||
      oldContext !== nextContext
    ) {
      // 【执行】实例的componentWillReceiveProps、UNSAFE_componentWillReceiveProps生命周期函数（前提是没有类的getDerivedStateFromProps和实例的getSnapshotBeforeUpdate）
      callComponentWillReceiveProps( // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        workInProgress,
        instance,
        newProps,
        nextContext,
      );
    }
  }

  resetHasForceUpdateBeforeProcessing();

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  processUpdateQueue(workInProgress, newProps, instance, renderLanes); // 处理更新队列 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // 主要就是处理wip的updateQueue的
  // 1.把wip.updateQueue.shared.pending = null
  // 2.把partialState对象放置在wip的updateQueue.baseState上的
  // 3.把partialState对象放置在wip的memoizedState上 // +++++++++++++++++++++++++++++++++++++++++++++++++++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  /* 
  对于setState这个api共有两个参数
  // 第一个参数可以是对象、函数
  // 第二个参数是一个函数
  */
  
  /* 
  packages/react-reconciler/src/ReactFiberClassUpdateQueue.new.js中的processUpdateQueue函数
  对于setState来讲它产生的update对象简述为以下格式
  {
    ...
    tag: UpdateState
    payload: 对象或函数
    callback: 函数
  }
  // 那么在上面的getStateFromUpdate函数中就会直接使用【对象】或进行【调用函数】然后【合并】得出newState
  // 而这个callback如果存在则存入workInProgress.updateQueue.callbacks数组中
  // 然后再给workInProgress fiber的flags加上Callback标记
  */

  // partialState
  newState = workInProgress.memoizedState; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 不应该更新
  // 若有实例的componentDidUpdate则将wip的flags加上Update标记
  // 若有实例的getSnapshotBeforeUpdate则将wip的flags加上Snapshot标记
  if (
    unresolvedOldProps === unresolvedNewProps &&
    oldState === newState &&
    !hasContextChanged() &&
    !checkHasForceUpdateAfterProcessing() &&
    !(
      enableLazyContextPropagation &&
      current !== null &&
      current.dependencies !== null &&
      checkIfContextChanged(current.dependencies)
    )
  ) {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Update; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      }
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Snapshot; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      }
    }
    return false;
  }

  // 应该更新代表着下面还要调用render函数然后reconcileChildren之后return workInProgress.child
  // 而不应该更新表示直接return workInProgress.child.alternate（因为在createWorkInProgress中wip的child还是指向着current.child的，所以
  // 它这里直接复用return wip.child = wip.child.alternate）

  // 应该更新
  // 【执行】getDerivedStateFromProps生命周期函数
  if (typeof getDerivedStateFromProps === 'function') {
    applyDerivedStateFromProps( // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      workInProgress,
      ctor,
      getDerivedStateFromProps,
      newProps,
    );
    newState = workInProgress.memoizedState; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||

    // +++
    checkShouldComponentUpdate( // 【执行】实例的shouldComponentUpdate生命周期函数 // ++++++++++++++++++++++++++++++++++++++++++++++++
      workInProgress,
      ctor,
      oldProps,
      newProps,
      oldState,
      newState,
      nextContext,
    ) ||
    // TODO: In some cases, we'll end up checking if context has changed twice,
    // both before and after `shouldComponentUpdate` has been called. Not ideal,
    // but I'm loath to refactor this function. This only happens for memoized
    // components so it's not that common.
    (enableLazyContextPropagation &&
      current !== null &&
      current.dependencies !== null &&
      checkIfContextChanged(current.dependencies));
  /* 
  function checkShouldComponentUpdate( // 检查是否应该组件更新 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++
  workInProgress,
  ctor,
  oldProps,
  newProps,
  oldState,
  newState,
  nextContext,
) {
  const instance = workInProgress.stateNode;
  if (typeof instance.shouldComponentUpdate === 'function') {
    let shouldUpdate = instance.shouldComponentUpdate(
      newProps,
      newState,
      nextContext,
    );
    return shouldUpdate;
  }

  if (ctor.prototype && ctor.prototype.isPureReactComponent) { // PureComponent 浅比较 // +++++++++++++++++++++++++++++++++++++++++++++++++++++
    return (
      !shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState)
    );
  }

  return true;
}
  */

  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  if (shouldUpdate) {
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillUpdate === 'function' ||
        typeof instance.componentWillUpdate === 'function')
    ) {
      /// 【执行】实例的componentWillUpdate、UNSAFE_componentWillUpdate生命周期函数（前提是没有类的getDerivedStateFromProps和实例的getSnapshotBeforeUpdate）
      if (typeof instance.componentWillUpdate === 'function') {
        instance.componentWillUpdate(newProps, newState, nextContext); // +++++++++++++++++++++++++++++++++++++++++++++++++++
      }
      if (typeof instance.UNSAFE_componentWillUpdate === 'function') {
        instance.UNSAFE_componentWillUpdate(newProps, newState, nextContext); // +++++++++++++++++++++++++++++++++++++++++++++++
      }
    }


    // 若有实例的componentDidUpdate则将wip的flags加上Update标记
    // 若有实例的getSnapshotBeforeUpdate则将wip的flags加上Snapshot标记
    if (typeof instance.componentDidUpdate === 'function') {
      workInProgress.flags |= Update; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      workInProgress.flags |= Snapshot; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }

    
  } else {

    // 若有实例的componentDidUpdate则将wip的flags加上Update标记
    // 若有实例的getSnapshotBeforeUpdate则将wip的flags加上Snapshot标记

    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Update; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      }
    }
    if (typeof instance.getSnapshotBeforeUpdate === 'function') {
      if (
        unresolvedOldProps !== current.memoizedProps ||
        oldState !== current.memoizedState
      ) {
        workInProgress.flags |= Snapshot; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      }
    }

    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // If shouldComponentUpdate returned false, we should still update the
    // memoized props/state to indicate that this work can be reused.
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // Update the existing instance's state, props, and context pointers even
  // if shouldComponentUpdate returns false.
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  return shouldUpdate;
}

export {
  adoptClassInstance,
  constructClassInstance,
  mountClassInstance,
  resumeMountClassInstance,
  updateClassInstance,
};
