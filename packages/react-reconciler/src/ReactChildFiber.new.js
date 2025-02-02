/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactElement} from 'shared/ReactElementType';
import type {ReactPortal} from 'shared/ReactTypes';
import type {Fiber} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane.new';

import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import {
  Placement,
  ChildDeletion,
  Forked,
  PlacementDEV,
} from './ReactFiberFlags';
import {
  getIteratorFn,
  REACT_ELEMENT_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_PORTAL_TYPE,
  REACT_LAZY_TYPE,
} from 'shared/ReactSymbols';
import {ClassComponent, HostText, HostPortal, Fragment} from './ReactWorkTags';
import isArray from 'shared/isArray';
import {warnAboutStringRefs} from 'shared/ReactFeatureFlags';
import {checkPropStringCoercion} from 'shared/CheckStringCoercion';

import {
  createWorkInProgress,
  resetWorkInProgress,
  createFiberFromElement,
  createFiberFromFragment,
  createFiberFromText,
  createFiberFromPortal,
} from './ReactFiber.new';
import {emptyRefsObject} from './ReactFiberClassComponent.new';
import {isCompatibleFamilyForHotReloading} from './ReactFiberHotReloading.new';
import {StrictLegacyMode} from './ReactTypeOfMode';
import {getIsHydrating} from './ReactFiberHydrationContext.new';
import {pushTreeFork} from './ReactFiberTreeContext.new';

let didWarnAboutMaps;
let didWarnAboutGenerators;
let didWarnAboutStringRefs;
let ownerHasKeyUseWarning;
let ownerHasFunctionTypeWarning;
let warnForMissingKey = (child: mixed, returnFiber: Fiber) => {};

if (__DEV__) {
  didWarnAboutMaps = false;
  didWarnAboutGenerators = false;
  didWarnAboutStringRefs = {};

  /**
   * Warn if there's no key explicitly set on dynamic arrays of children or
   * object keys are not valid. This allows us to keep track of children between
   * updates.
   */
  ownerHasKeyUseWarning = {};
  ownerHasFunctionTypeWarning = {};

  warnForMissingKey = (child: mixed, returnFiber: Fiber) => {
    if (child === null || typeof child !== 'object') {
      return;
    }
    if (!child._store || child._store.validated || child.key != null) {
      return;
    }

    if (typeof child._store !== 'object') {
      throw new Error(
        'React Component in warnForMissingKey should have a _store. ' +
          'This error is likely caused by a bug in React. Please file an issue.',
      );
    }

    // $FlowFixMe unable to narrow type from mixed to writable object
    child._store.validated = true;

    const componentName = getComponentNameFromFiber(returnFiber) || 'Component';

    if (ownerHasKeyUseWarning[componentName]) {
      return;
    }
    ownerHasKeyUseWarning[componentName] = true;

    console.error(
      'Each child in a list should have a unique ' +
        '"key" prop. See https://reactjs.org/link/warning-keys for ' +
        'more information.',
    );
  };
}

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
function coerceRef(
  returnFiber: Fiber,
  current: Fiber | null,
  element: ReactElement,
) {
  /* 
  对于函数式组件中来讲
  function App() {
    const myRef = useRef()

    <div ref={myRef}></div>
  }
  // 这个element中的ref属性其实就是这个myRef对象 - {current: initialValue}
  */
  const mixedRef = element.ref; // 是个对象
  if (
    mixedRef !== null &&
    typeof mixedRef !== 'function' &&
    typeof mixedRef !== 'object'
  ) {
    if (__DEV__) {
      // TODO: Clean this up once we turn on the string ref warning for
      // everyone, because the strict mode case will no longer be relevant
      if (
        (returnFiber.mode & StrictLegacyMode || warnAboutStringRefs) &&
        // We warn in ReactElement.js if owner and self are equal for string refs
        // because these cannot be automatically converted to an arrow function
        // using a codemod. Therefore, we don't have to warn about string refs again.
        !(
          element._owner &&
          element._self &&
          element._owner.stateNode !== element._self
        )
      ) {
        const componentName =
          getComponentNameFromFiber(returnFiber) || 'Component';
        if (!didWarnAboutStringRefs[componentName]) {
          if (warnAboutStringRefs) {
            console.error(
              'Component "%s" contains the string ref "%s". Support for string refs ' +
                'will be removed in a future major release. We recommend using ' +
                'useRef() or createRef() instead. ' +
                'Learn more about using refs safely here: ' +
                'https://reactjs.org/link/strict-mode-string-ref',
              componentName,
              mixedRef,
            );
          } else {
            console.error(
              'A string ref, "%s", has been found within a strict mode tree. ' +
                'String refs are a source of potential bugs and should be avoided. ' +
                'We recommend using useRef() or createRef() instead. ' +
                'Learn more about using refs safely here: ' +
                'https://reactjs.org/link/strict-mode-string-ref',
              mixedRef,
            );
          }
          didWarnAboutStringRefs[componentName] = true;
        }
      }
    }

    if (element._owner) {
      const owner: ?Fiber = (element._owner: any);
      let inst;
      if (owner) {
        const ownerFiber = ((owner: any): Fiber);

        if (ownerFiber.tag !== ClassComponent) {
          throw new Error(
            'Function components cannot have string refs. ' +
              'We recommend using useRef() instead. ' +
              'Learn more about using refs safely here: ' +
              'https://reactjs.org/link/strict-mode-string-ref',
          );
        }

        inst = ownerFiber.stateNode;
      }

      if (!inst) {
        throw new Error(
          `Missing owner for string ref ${mixedRef}. This error is likely caused by a ` +
            'bug in React. Please file an issue.',
        );
      }
      // Assigning this to a const so Flow knows it won't change in the closure
      const resolvedInst = inst;

      if (__DEV__) {
        checkPropStringCoercion(mixedRef, 'ref');
      }
      const stringRef = '' + mixedRef;
      // Check if previous string ref matches new string ref
      if (
        current !== null &&
        current.ref !== null &&
        typeof current.ref === 'function' &&
        current.ref._stringRef === stringRef
      ) {
        return current.ref;
      }
      const ref = function(value) {
        let refs = resolvedInst.refs;
        if (refs === emptyRefsObject) {
          // This is a lazy pooled frozen object, so we need to initialize.
          refs = resolvedInst.refs = {};
        }
        if (value === null) {
          delete refs[stringRef];
        } else {
          refs[stringRef] = value;
        }
      };
      ref._stringRef = stringRef;
      return ref;
    } else {
      if (typeof mixedRef !== 'string') {
        throw new Error(
          'Expected ref to be a function, a string, an object returned by React.createRef(), or null.',
        );
      }

      if (!element._owner) {
        throw new Error(
          `Element ref was specified as a string (${mixedRef}) but no owner was set. This could happen for one of` +
            ' the following reasons:\n' +
            '1. You may be adding a ref to a function component\n' +
            "2. You may be adding a ref to a component that was not created inside a component's render method\n" +
            '3. You have multiple copies of React loaded\n' +
            'See https://reactjs.org/link/refs-must-have-owner for more information.',
        );
      }
    }
  }

  /// 直接返回上面的那个对象 - {current: initialValue}
  return mixedRef;
}

function throwOnInvalidObjectType(returnFiber: Fiber, newChild: Object) {
  // $FlowFixMe[method-unbinding]
  const childString = Object.prototype.toString.call(newChild);

  throw new Error(
    `Objects are not valid as a React child (found: ${
      childString === '[object Object]'
        ? 'object with keys {' + Object.keys(newChild).join(', ') + '}'
        : childString
    }). ` +
      'If you meant to render a collection of children, use an array ' +
      'instead.',
  );
}

function warnOnFunctionType(returnFiber: Fiber) {
  if (__DEV__) {
    const componentName = getComponentNameFromFiber(returnFiber) || 'Component';

    if (ownerHasFunctionTypeWarning[componentName]) {
      return;
    }
    ownerHasFunctionTypeWarning[componentName] = true;

    console.error(
      'Functions are not valid as a React child. This may happen if ' +
        'you return a Component instead of <Component /> from render. ' +
        'Or maybe you meant to call this function rather than return it.',
    );
  }
}

// +++
function resolveLazy(lazyType) { // +++
  const payload = lazyType._payload;
  const init = lazyType._init;
  // 执行这个init函数 // ++++++
  return init(payload); // +++
}

type ChildReconciler = (
  returnFiber: Fiber,
  currentFirstChild: Fiber | null,
  newChild: any,
  lanes: Lanes,
) => Fiber | null;

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// This wrapper function exists because I expect to clone the code in each path
// to be able to optimize each path individually by branching early. This needs
// a compiler or we can do it manually. Helpers that don't need this branching
// live outside of this function.
// +++
// 创建孩子调和器
function createChildReconciler(shouldTrackSideEffects): ChildReconciler { // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // 删除孩子 - 直接把需要删除的fiber添加进returnFiber的deletions数组中，同时给returnFiber的flags加上ChildDeletion标记 // +++
  function deleteChild(returnFiber: Fiber, childToDelete: Fiber): void {
    // 若不应该收集
    if (!shouldTrackSideEffects) {
      // 没有。
      // Noop.
      return; // 返回
    }
    const deletions = returnFiber.deletions;
    if (deletions === null) {
      returnFiber.deletions = [childToDelete];
      returnFiber.flags |= ChildDeletion;
    } else {
      deletions.push(childToDelete);
    }
  }

  // 删除其余的孩子 - 主要就是进行遍历currentFirstChild以及它的sibling然后依次把其加入到returnFiber的deletions数组中，然后给returnFiber的flags加上ChildDeletion标记
  function deleteRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
  ): null {

    // 不应该收集
    if (!shouldTrackSideEffects) {
      // 没有。
      // Noop.
      return null; // 返回null
    }

    // TODO: For the shouldClone case, this could be micro-optimized a bit by
    // assuming that after the first child we've already added everything.
    let childToDelete = currentFirstChild;
    while (childToDelete !== null) {
      deleteChild(returnFiber, childToDelete);
      childToDelete = childToDelete.sibling;
    }

    // 返回null // +++
    return null;
  }

  // 映射其余的孩子 - 遍历currentFirstChild和它的sibling，然后依次把它们的key和自身fiber做映射添加进map中（没有key的则采用fiber的index下标），最终返回这个map
  function mapRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber,
  ): Map<string | number, Fiber> {
    // Add the remaining children to a temporary map so that we can find them by
    // keys quickly. Implicit (null) keys get added to this set with their index
    // instead.
    const existingChildren: Map<string | number, Fiber> = new Map(); // 已存在的孩子map

    let existingChild: null | Fiber = currentFirstChild;
    while (existingChild !== null) {
      if (existingChild.key !== null) {
        existingChildren.set(existingChild.key, existingChild);
      } else {
        existingChildren.set(existingChild.index, existingChild);
      }
      existingChild = existingChild.sibling;
    }
    return existingChildren;
  }

  // 检查参数fiber的alternate是否存在
  //   若没有则按照此fiber的属性创建一个新的FiberNode，同时使其之间通过alternate属性相互进行关联
  //   若有则直接使用这个alternate对应的FiberNode，同时按照此参数fiber的属性更新到这个FiberNode上
  // 这里额外的事情就是让其index为0，sibling为null
  // 最终返回这个FiberNode
  function useFiber(fiber: Fiber, pendingProps: mixed): Fiber {
    // We currently set sibling to null and index to 0 here because it is easy
    // to forget to do before returning it. E.g. for the single child case.
    const clone = createWorkInProgress(fiber, pendingProps);
    clone.index = 0;
    clone.sibling = null;
    return clone;
  }

  // 放置孩子
  // 存储当前的下标
  // 检查这个newFiber是否有alternate属性 <- current
  //   若有则判断current它的index与lastPlacedIndex之间的关系
  //     < -> 说明是一个移动，返回lastPlacedIndex
  //     >= -> 保持原先位置不变，返回current的index
  //   若没有则说明这个newFiber是一个插入，返回lastPlacedIndex
  function placeChild(
    newFiber: Fiber,
    lastPlacedIndex: number, // 上一次放置的下标
    newIndex: number, // 新的下标
  ): number {
    
    // 存储index
    newFiber.index = newIndex;

    if (!shouldTrackSideEffects) {
      // During hydration, the useId algorithm needs to know which fibers are
      // part of a list of children (arrays, iterators).
      newFiber.flags |= Forked;
      return lastPlacedIndex;
    }

    // 取出它的alternate属性
    const current = newFiber.alternate;
        
    if (current !== null) {
      const oldIndex = current.index;
      if (oldIndex < lastPlacedIndex) {
        // 这是一个移动
        // This is a move.
        newFiber.flags |= Placement | PlacementDEV;
        return lastPlacedIndex;
      } else {
        // 这一项可以待在这个位置
        // This item can stay in place.
        return oldIndex;
      }
    } else {
      // 这是一个插入
      // This is an insertion.
      newFiber.flags |= Placement | PlacementDEV;
      return lastPlacedIndex;
    }
  }

  // 放置单个孩子
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
  function placeSingleChild(newFiber: Fiber): Fiber {
    // 对于单节点情况，这更简单。我们只需要做插入新子节点的安置。 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // This is simpler for the single child case. We only need to do a
    // placement for inserting new children.
    // 应该收集 且 这个newFiber的alternate属性是为null // +++
    if (shouldTrackSideEffects && newFiber.alternate === null) { // 参数fiber的alternate是null才会进行打这个Placement标记的 // ++++++++++++++++++++++++++++++++++
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      newFiber.flags |= Placement | PlacementDEV; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }

    // 返回这个newFiber
    return newFiber; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }

  // 更新文本节点
  // current === null || current.tag !== HostText - 则直接创建一个关于文本的FiberNode
  // else -> 
  //   检查参数fiber的alternate是否存在
  //     若没有则按照此fiber的属性创建一个新的FiberNode，同时使其之间通过alternate属性相互进行关联
  //     若有则直接使用这个alternate对应的FiberNode，同时按照此参数fiber的属性更新到这个FiberNode上
  //   这里额外的事情就是让其index为0，sibling为null
  //   最终返回这个FiberNode
  function updateTextNode(
    returnFiber: Fiber,
    current: Fiber | null,
    textContent: string,
    lanes: Lanes,
  ) {
    if (current === null || current.tag !== HostText) {
      // Insert
      const created = createFiberFromText(textContent, returnFiber.mode, lanes);
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, textContent);
      existing.return = returnFiber;
      return existing;
    }
  }

  // 更新元素
  function updateElement(
    returnFiber: Fiber,
    current: Fiber | null,
    element: ReactElement,
    lanes: Lanes,
  ): Fiber {
    const elementType = element.type;

    // 是否为fragment
    if (elementType === REACT_FRAGMENT_TYPE) {
      
      // 则直接更新fragment
      return updateFragment(
        returnFiber,
        current,
        element.props.children,
        lanes,
        element.key,
      );
    }

    // current不为null
    if (current !== null) {
      if (
        current.elementType === elementType || // 它俩之间是否相等
        // Keep this check inline so it only runs on the false path:
        (__DEV__
          ? isCompatibleFamilyForHotReloading(current, element)
          : false) ||
        // Lazy types should reconcile their resolved type.
        // We need to do this after the Hot Reloading check above,
        // because hot reloading has different semantics than prod because
        // it doesn't resuspend. So we can't let the call below suspend.
        (typeof elementType === 'object' &&
          elementType !== null &&
          elementType.$$typeof === REACT_LAZY_TYPE &&
          resolveLazy(elementType) === current.type) // 解析lazy
          /* 
          function resolveLazy(lazyType) { // +++
            const payload = lazyType._payload;
            const init = lazyType._init;
            // 执行这个init函数 // ++++++
            return init(payload); // +++
          }
          */
      ) {
        // 根据索引移动
        // Move based on index
        const existing = useFiber(current, element.props);
        /* 
        // 检查参数fiber的alternate是否存在
        //   若没有则按照此fiber的属性创建一个新的FiberNode，同时使其之间通过alternate属性相互进行关联
        //   若有则直接使用这个alternate对应的FiberNode，同时按照此参数fiber的属性更新到这个FiberNode上
        // 这里额外的事情就是让其index为0，sibling为null
        // 最终返回这个FiberNode
        */

        existing.ref = coerceRef(returnFiber, current, element);
        existing.return = returnFiber;
        if (__DEV__) {
          existing._debugSource = element._source;
          existing._debugOwner = element._owner;
        }
        return existing;
      }
    }

    // current为null - 则创建一个关于react元素的FiberNode
    // Insert
    const created = createFiberFromElement(element, returnFiber.mode, lanes);
    created.ref = coerceRef(returnFiber, current, element);
    created.return = returnFiber;
    return created;
  }

  // 更新portal
  function updatePortal(
    returnFiber: Fiber,
    current: Fiber | null,
    portal: ReactPortal,
    lanes: Lanes,
  ): Fiber {
    if (
      current === null || // current为null
      current.tag !== HostPortal || // current的tag不是HostPortal
      current.stateNode.containerInfo !== portal.containerInfo || /// +++
      current.stateNode.implementation !== portal.implementation // +++
    ) {
      // 创建一个关于portal的FiberNode
      // Insert
      const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, portal.children || []);
      /* 
      // 检查参数fiber的alternate是否存在
      //   若没有则按照此fiber的属性创建一个新的FiberNode，同时使其之间通过alternate属性相互进行关联
      //   若有则直接使用这个alternate对应的FiberNode，同时按照此参数fiber的属性更新到这个FiberNode上
      // 这里额外的事情就是让其index为0，sibling为null
      // 最终返回这个FiberNode
      */
      existing.return = returnFiber;
      return existing;
    }
  }

  // 更新fragment
  function updateFragment(
    returnFiber: Fiber,
    current: Fiber | null,
    fragment: Iterable<React$Node>,
    lanes: Lanes,
    key: null | string,
  ): Fiber {
    // current为null 或者 它的tag不是Fragment
    if (current === null || current.tag !== Fragment) {
      // 创建一个关于fragment的FiberNode
      // Insert
      const created = createFiberFromFragment(
        fragment,
        returnFiber.mode,
        lanes,
        key,
      );
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, fragment);
      /* 
      // 检查参数fiber的alternate是否存在
      //   若没有则按照此fiber的属性创建一个新的FiberNode，同时使其之间通过alternate属性相互进行关联
      //   若有则直接使用这个alternate对应的FiberNode，同时按照此参数fiber的属性更新到这个FiberNode上
      // 这里额外的事情就是让其index为0，sibling为null
      // 最终返回这个FiberNode
      */

      existing.return = returnFiber;
      return existing;
    }
  }

  // 创建child // +++
  function createChild(
    returnFiber: Fiber,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {

    // newChild为字符串且不是空串 或者 newChild是数字
    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number'
    ) {

      // 创建一个关于text的FiberNode

      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      const created = createFiberFromText(
        '' + newChild,
        returnFiber.mode,
        lanes,
      );
      created.return = returnFiber;
      return created;
    }

    // newChild是对象且不为null
    if (typeof newChild === 'object' && newChild !== null) {
      
      // 查看newChild的$$typeof属性
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          // 创建一个关于react元素的FiberNode
          const created = createFiberFromElement(
            newChild,
            returnFiber.mode,
            lanes,
          );
          created.ref = coerceRef(returnFiber, null, newChild);
          created.return = returnFiber;
          return created;
        }
        case REACT_PORTAL_TYPE: {
          const created = createFiberFromPortal(
            newChild,
            returnFiber.mode,
            lanes,
          );
          created.return = returnFiber;
          return created;
        }
        case REACT_LAZY_TYPE: {
          const payload = newChild._payload;
          const init = newChild._init;
          return createChild(returnFiber, init(payload), lanes);
        }
      }

      // +++
      if (isArray(newChild) || getIteratorFn(newChild)) {
        // 创建一个关于fragment的FiberNode
        const created = createFiberFromFragment(
          newChild,
          returnFiber.mode,
          lanes,
          null,
        );
        created.return = returnFiber;
        return created;
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }

  // 更新插槽
  function updateSlot(
    returnFiber: Fiber,
    oldFiber: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // 如果key匹配，则更新fiber，否则返回 null。
    // Update the fiber if the keys match, otherwise return null.

    // 老fiber的key - 老fiber没有则直接为null
    const key = oldFiber !== null ? oldFiber.key : null;

    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number'
    ) {
      // 文本节点没有key。如果之前的节点是隐式key设置的，则可以继续替换它而不中止，即使它不是文本节点。
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      if (key !== null) { // key不为null则直接返回null
        return null;
      }
      // 更新文本节点 // +++
      return updateTextNode(returnFiber, oldFiber, '' + newChild, lanes);
      // function updateTextNode(
      //   returnFiber: Fiber,
      //   current: Fiber | null,
      //   textContent: string,
      //   lanes: Lanes,
      // ) {
      //   if (current === null || current.tag !== HostText) {
      //     // Insert
      //     const created = createFiberFromText(textContent, returnFiber.mode, lanes);
      //     created.return = returnFiber;
      //     return created;
      //   } else {
      //     // Update
      //     const existing = useFiber(current, textContent); // workInProgress.pendingProps
      //     existing.return = returnFiber;
      //     return existing;
      //   }
      // }
    }

    // newChild为对象且不为null
    if (typeof newChild === 'object' && newChild !== null) {

      // 取出它的$$typeof属性
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          if (newChild.key === key) { // key是否相同 - 相同则直接更新元素
            return updateElement(returnFiber, oldFiber, newChild, lanes);
          } else {
            return null;
          }
        }
        case REACT_PORTAL_TYPE: {
          if (newChild.key === key) {
            return updatePortal(returnFiber, oldFiber, newChild, lanes);
          } else {
            return null;
          }
        }
        case REACT_LAZY_TYPE: {
          const payload = newChild._payload;
          const init = newChild._init;
          return updateSlot(returnFiber, oldFiber, init(payload), lanes);
        }
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        if (key !== null) { // 老fiber的key不为null - 则直接返回null
          return null;
        }

        // 更新fragment
        return updateFragment(returnFiber, oldFiber, newChild, lanes, null);
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }

  /// 从mao中进行更新
  function updateFromMap(
    existingChildren: Map<string | number, Fiber>,
    returnFiber: Fiber,
    newIdx: number,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number'
    ) {
      // Text nodes don't have keys, so we neither have to check the old nor
      // new node for the key. If both are text nodes, they match.
      const matchedFiber = existingChildren.get(newIdx) || null; // map中获取新的下标

      // 更新文本节点
      return updateTextNode(returnFiber, matchedFiber, '' + newChild, lanes);
    }

    // newChild为对象且不为null
    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key, // 没有key则使用下标，有key则直接使用
            ) || null;

          // 更新元素
          return updateElement(returnFiber, matchedFiber, newChild, lanes);
        }
        case REACT_PORTAL_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null;
          return updatePortal(returnFiber, matchedFiber, newChild, lanes);
        }
        case REACT_LAZY_TYPE:
          const payload = newChild._payload;
          const init = newChild._init;
          return updateFromMap(
            existingChildren,
            returnFiber,
            newIdx,
            init(payload),
            lanes,
          );
      }

      // +++
      if (isArray(newChild) || getIteratorFn(newChild)) {
        const matchedFiber = existingChildren.get(newIdx) || null;

        // 更新fragment
        return updateFragment(returnFiber, matchedFiber, newChild, lanes, null);
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }

  /**
   * Warns if there is a duplicate or missing key
   */
  function warnOnInvalidKey(
    child: mixed,
    knownKeys: Set<string> | null,
    returnFiber: Fiber,
  ): Set<string> | null {
    if (__DEV__) {
      if (typeof child !== 'object' || child === null) {
        return knownKeys;
      }
      switch (child.$$typeof) {
        case REACT_ELEMENT_TYPE:
        case REACT_PORTAL_TYPE:
          warnForMissingKey(child, returnFiber);
          const key = child.key;
          if (typeof key !== 'string') {
            break;
          }
          if (knownKeys === null) {
            knownKeys = new Set();
            knownKeys.add(key);
            break;
          }
          if (!knownKeys.has(key)) {
            knownKeys.add(key);
            break;
          }
          console.error(
            'Encountered two children with the same key, `%s`. ' +
              'Keys should be unique so that components maintain their identity ' +
              'across updates. Non-unique keys may cause children to be ' +
              'duplicated and/or omitted — the behavior is unsupported and ' +
              'could change in a future version.',
            key,
          );
          break;
        case REACT_LAZY_TYPE:
          const payload = child._payload;
          const init = (child._init: any);
          warnOnInvalidKey(init(payload), knownKeys, returnFiber);
          break;
        default:
          break;
      }
    }
    return knownKeys;
  }

  // 多节点的diff
  /* 
  简化版概括

  resultingFirstChild: 结果第一个child -> null - 是为了作为父级的直接child
  previousNewFiber: 上一个新的fiber -> null - 是为了构建child的sibling的
  oldFiber: 旧的fiber -> currentFirstChild
  lastPlacedIndex: 上一个放置下标 -> 0 - 它的值就是对应current fiber的index（继续待在原先位置不变的index）
    【每复用一个且它的current的下标 >= lastPlacedIndex表示可以待在原位置那么就会替换成原位置的index -> 那么这样也就表示出这个lastPlacedIndex具体意思是上一个待在原位置的下标（它是current的）
    上一个待在原位置（不需要去移动的）的下标（它是current的）默认为0】
  
  newIdx: 新的下标 -> 0
  nextOldFiber: 下一个旧的fiber -> null

  // ++++++
  // 1. 
  // 头和头相比较
  //   相同（key和type一致）则复用，返回newFiber，然后对newFiber采用placeChild策略
  //   不相同返回null然后直接退出for循环
  for (; oldFiber !== null && newIdx < newChildren.length; newIdx++)
    if (oldFiber.index > newIdx)
      nextOldFiber = oldFiber
      oldFiber = null
    else
      nextOldFiber = oldFiber.sibling

    newFiber -> updateSlot(
      returnFiber,
      oldFiber,
      newChildren[newIdx],
      lanes,
    )

    if (newFiber === null)
      if (oldFiber === null)
        oldFiber = nextOldFiber
      break

    if (shouldTrackSideEffects)
      if (oldFiber && newFiber.alternate === null)
        deleteChild(returnFiber, oldFiber)
    
    lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx)

    if (previousNewFiber === null)
      resultingFirstChild = newFiber
    else
      previousNewFiber.sibling = newFiber

    previousNewFiber = newFiber
    oldFiber = nextOldFiber

  
  // 2. 若新的遍历完毕，则直接对oldFiber采用deleteRemainingChildren 然后返回resultingFirstChild
  // 代表新的遍历完毕
  if newIdx === newChildren.length 则对oldFiber采用deleteRemainingChildren 然后返回resultingFirstChild

  // 3. 若旧的遍历完毕，直接对新的再次继续遍历 - 因为要挂载剩余新的
  if oldFiber === null - // 代表旧的遍历完毕
    for (; newIdx < newChildren.length; newIdx++) // 对新的再次继续遍历 - 因为要挂载剩余新的
      newFiber -> 首先对newChildren[newIdx]采用createChild策略
      if newFiber === null - continue
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx)
      if (previousNewFiber === null)
        resultingFirstChild -> newFiber
      else previousNewFiber.sibling = newFiber
      previousNewFiber = newFiber
    return resultingFirstChild

  // 4. 到这里说明旧的还没有遍历完毕，此时直接拿旧的key或者是index作为key，自身fiber作为value存储在map中
  // 说明旧的还没有遍历完毕，此时直接拿旧的key或者是index作为key，自身fiber作为value存储在map中
  existingChildren -> mapRemainingChildren(returnFiber, oldFiber)

  // 5. 继续遍历新的然后对newChildren[newIdx]采用updateFromMap策略（相同（key和type一致）则复用，返回newFiber，然后对newFiber采用placeChild策略
  //   不相同则创建一个新的FiberNode并返回它作为newFiber）之后对newFiber.alternate检查是否为null，不为null的话直接把newFiber的key或者是其index
  //   作为键从existingChildren这个map中删除键值对，然后对这个newFiber采用placeChild策略
  // 继续遍历新的
  for (; newIdx < newChildren.length; newIdx++)
    newFiber -> 对newChildren[newIdx]采用updateFromMap策略
    if (newFiber !== null)
      if (shouldTrackSideEffects)
        if (newFiber.alternate !== null)
          existingChildren.delete(
            newFiber.key === null ? newIdx : newFiber.key,
          )
      
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx)
      
      if (previousNewFiber === null)
        resultingFirstChild -> newFiber
      else previousNewFiber.sibling = newFiber
      previousNewFiber = newFiber
  
  // 6. 遍历完毕新的以后发现在map中还有旧的，那么直接一一做删除即可
  // 遍历完毕新的以后发现在map中还有旧的，那么直接做删除即可
  if (shouldTrackSideEffects)
    existingChildren.forEach(child => deleteChild(returnFiber, child))
  
  return resultingFirstChild
  */
  // ++++++

  // ++++++
  // +++
  // placeChild的上层含义：
  // 
  // placeChild的作用就是为了把lastPlacedIndex一一设置为【不需要进行移动的current对应的下标的】，需要进行移动不会设置（vue3中的maxNewIndexSoFar是设置为需要进行移动的新的对应的下标，不需要进行移动的不会设置（以a b c -> b c a为例）因为它是以正序遍历旧的在新的里面找！！！）
  // 那么这样的话a b c -> a c b对于新旧顺序一致的这个lastPlacedIndex会一一变为current对应的下标
  // 那么一旦当出现顺序不一致不管是xxx移到yyy的前面还是xxx移到yyy的后面在react中统一变为把xxx移到yyy的后面（因为是按正序遍历新的所以说一旦出现了xxx移到yyy的后面时（xxx yyy -> yyy xxx）
  // 此时lastPlacedIndex就会记录yyy对应的current对应的下标，那么当访问到xxx时（因为是正序遍历新的所以是先遍历yyy再遍历xxx）而它的current下标是在yyy对应current下标的前面，所以这就意味着
  // xxx是需要进行移到的）
  // 那这个就是把b移到c的后面，所以lastPlacedIndex会设置为c对应的current的下标，那么这样当遍历到b的时候（因为后面是按正序遍历新的）它在current里面的下标是<lastPlacedIndex
  // 那么所以这个b就是需要进行移动的 // +++
  // +++

  // placeChild的应用之对应的最终表现关系总结：
  // a b c -> c a b
  // 实际上是把c移动到a的前面 - 【那么它所对应的关系实际上就是把a b移到c的后面】
  // a b c -> b c a
  // 【实际上是把a移到c的后面】 - 那么另一种关系就是b c移到a的前面

  // 【而在react中一律视为把xxx移到yyy的后面】
  // 那么所以最终移动的就是xxx，而不需移动的就是yyy了
  /* 
  以a b c -> c a b为例
  vue3和react之间的diff算法对比
  
  vue3
  1. 先是头和头比较直接不相同那么直接停止
  2. 尾和尾比较也是直接不相同那么也是直接停止
  3. 之后对新的停止序列做遍历以key=>index为键值对存入map中，然后以这段新的序列的长度3重新创建一个数组A初始化为0（0代表当前对应的这个vnode是需要挂载的）
  4. 然后遍历旧的停止序列以key在map中取出，若有直接patch（props、children）复用dom然后把value作为数组A的下标进行访问，以当前旧的序列下标+1为值存入数组A中，若没有则直接卸载
  5. 当前数组A[3, 1, 2]
  6.          c  a  b
  7. 对数组A使用最长递增子序列算法得出最长递增子序列的下标也就是元素1和2对应的下标[1, 2]数组B - 它代表不需要去移动的旧的下标+1的值元素在数组A（其实对应的就是c a b）中所在的下标
  8. 之后对新的停止序列再次进行【倒序】遍历，按照当前的下标在数组A取出是否为0，为0则代表需要挂载，不为0则看数组B中倒着取出元素值是否与当前遍历的下标一样
    一样则代表不需要去移动直接跳过即可，不一样则当前的vnode的el需要去移动其中以当前vnode的后一个vnode的el为参照物来去移动的。
  
  所以最终你会发现在vue3中a b是不需要去移动，而移动的仅仅只是c
  https://github.com/benxiaohaiw/core-source-analysis-v3.2.41/blob/main/packages/runtime-core/src/renderer.ts

  react
  1. 头和头比较直接不相同那么在第一个for循环停止下来
  2. 新的没有遍历完
  3. 旧的也没有遍历完
  4. 直接把旧的key和自身fiber作为键值对存入一个map中
  5. 遍历新的元素，拿它的key在map中取有则复用，没有则新创建一个fiber，之后就是placeChild策略啦
    c a b对应下标 -> 0 1 2
    新的下标位置处对应的current下标 -> 2 0 1
    lastPlacedIndex -> 2 2 2
  6. map中还有则一一进行删除即可

  所以最终你会发现c不需要去移动，而移动的是a b

  */

  // 重点
  /* 
  placeChild的整体流程

  // 放置孩子
  // 存储当前的下标
  // 检查这个newFiber是否有alternate属性 <- current
  //   若有则判断current它的index与lastPlacedIndex之间的关系
  //     < -> 说明是一个移动，返回lastPlacedIndex
  //     >= -> 保持原先位置不变，返回current的index // +++
  //   若没有则说明这个newFiber是一个插入，返回lastPlacedIndex
  */
  // 调和孩子数组 // +++
  // ++++++
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  function reconcileChildrenArray( // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildren: Array<any>,
    lanes: Lanes,
  ): Fiber | null {
    // This algorithm can't optimize by searching from both ends since we
    // don't have backpointers on fibers. I'm trying to see how far we can get
    // with that model. If it ends up not being worth the tradeoffs, we can
    // add it later.

    // Even with a two ended optimization, we'd want to optimize for the case
    // where there are few changes and brute force the comparison instead of
    // going for the Map. It'd like to explore hitting that path first in
    // forward-only mode and only go for the Map once we notice that we need
    // lots of look ahead. This doesn't handle reversal as well as two ended
    // search but that's unusual. Besides, for the two ended optimization to
    // work on Iterables, we'd need to copy the whole set.

    // In this first iteration, we'll just live with hitting the bad case
    // (adding everything to a Map) in for every insert/move.

    // If you change this code, also update reconcileChildrenIterator() which
    // uses the same algorithm.

    if (__DEV__) {
      // First, validate keys.
      let knownKeys = null;
      for (let i = 0; i < newChildren.length; i++) {
        const child = newChildren[i];
        knownKeys = warnOnInvalidKey(child, knownKeys, returnFiber);
      }
    }

    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber = null;

    // 第一个for循环可以简要的概括为key如果相同的话那么直接复用老的fiber或者是创建新的（并收集老的fiber是要删除的）
    // 如果遇到了直接是不同的那么就退出当前的for循环

    // 按照新孩子的长度去遍历current.child // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
      // 老fiber原先所在下标位置 大于 现在遍历的下标 - 说明当前老fiber应该在之后操作
      // 与此同时把老fiber置为null
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        // 若是<=现在遍历的下标 - 那么下一个老的fiber应该是它的sibling
        nextOldFiber = oldFiber.sibling; // 下一个是它的sibling
      }

      // 更新插槽 - 
      const newFiber = updateSlot(
        returnFiber,
        oldFiber,
        newChildren[newIdx],
        lanes,
      );
      /* 
        function updateSlot(
    returnFiber: Fiber,
    oldFiber: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // 如果key匹配，则更新fiber，否则返回 null。
    // Update the fiber if the keys match, otherwise return null.

    const key = oldFiber !== null ? oldFiber.key : null;

    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number'
    ) {
      // 文本节点没有key。如果之前的节点是隐式key设置的，则可以继续替换它而不中止，即使它不是文本节点。
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      if (key !== null) {
        return null;
      }
      return updateTextNode(returnFiber, oldFiber, '' + newChild, lanes);
      // function updateTextNode(
      //   returnFiber: Fiber,
      //   current: Fiber | null,
      //   textContent: string,
      //   lanes: Lanes,
      // ) {
      //   if (current === null || current.tag !== HostText) {
      //     // Insert
      //     const created = createFiberFromText(textContent, returnFiber.mode, lanes);
      //     created.return = returnFiber;
      //     return created;
      //   } else {
      //     // Update // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      //     const existing = useFiber(current, textContent); // workInProgress.pendingProps // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      //     existing.return = returnFiber;
      //     return existing;
      //   }
      // }
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          if (newChild.key === key) {
            return updateElement(returnFiber, oldFiber, newChild, lanes);
          } else {
            return null;
          }
        }
        case REACT_PORTAL_TYPE: {
          if (newChild.key === key) {
            return updatePortal(returnFiber, oldFiber, newChild, lanes);
          } else {
            return null;
          }
        }
        case REACT_LAZY_TYPE: {
          const payload = newChild._payload;
          const init = newChild._init;
          return updateSlot(returnFiber, oldFiber, init(payload), lanes);
        }
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        if (key !== null) {
          return null;
        }

        return updateFragment(returnFiber, oldFiber, newChild, lanes, null);
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }

      */

  /* 
    function updateElement(
    returnFiber: Fiber,
    current: Fiber | null,
    element: ReactElement,
    lanes: Lanes,
  ): Fiber {
    const elementType = element.type;
    if (elementType === REACT_FRAGMENT_TYPE) {
      return updateFragment(
        returnFiber,
        current,
        element.props.children,
        lanes,
        element.key,
      );
    }
    if (current !== null) {
      if (
        current.elementType === elementType ||
        // Keep this check inline so it only runs on the false path:
        (__DEV__
          ? isCompatibleFamilyForHotReloading(current, element)
          : false) ||
        // Lazy types should reconcile their resolved type.
        // We need to do this after the Hot Reloading check above,
        // because hot reloading has different semantics than prod because
        // it doesn't resuspend. So we can't let the call below suspend.
        (typeof elementType === 'object' &&
          elementType !== null &&
          elementType.$$typeof === REACT_LAZY_TYPE &&
          resolveLazy(elementType) === current.type)
      ) {
        // Move based on index
        const existing = useFiber(current, element.props);
        existing.ref = coerceRef(returnFiber, current, element);
        existing.return = returnFiber;
        if (__DEV__) {
          existing._debugSource = element._source;
          existing._debugOwner = element._owner;
        }
        return existing;
      }
    }
    // Insert
    const created = createFiberFromElement(element, returnFiber.mode, lanes);
    created.ref = coerceRef(returnFiber, current, element);
    created.return = returnFiber;
    return created;
  }
  */

  /* 
    function updateFragment(
    returnFiber: Fiber,
    current: Fiber | null,
    fragment: Iterable<React$Node>,
    lanes: Lanes,
    key: null | string,
  ): Fiber {
    if (current === null || current.tag !== Fragment) {
      // Insert
      const created = createFiberFromFragment(
        fragment,
        returnFiber.mode,
        lanes,
        key,
      );
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, fragment);
      existing.return = returnFiber;
      return existing;
    }
  }
  */


      // 只有在两者key不一样时 - newFiber才会为null
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break; // 退出当前循环
      }

      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // 我们匹配了插槽，但没有重用现有的fiber，因此需要删除现有的子节点。
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          deleteChild(returnFiber, oldFiber);
        }
      }
      // lastPlacedIndex: 上一次移动的下标
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      /* 
        function placeChild(
    newFiber: Fiber,
    lastPlacedIndex: number,
    newIndex: number,
  ): number {
    newFiber.index = newIndex;
    if (!shouldTrackSideEffects) {
      // During hydration, the useId algorithm needs to know which fibers are
      // part of a list of children (arrays, iterators).
      newFiber.flags |= Forked;
      return lastPlacedIndex;
    }
    const current = newFiber.alternate;
    if (current !== null) {
      const oldIndex = current.index;
      if (oldIndex < lastPlacedIndex) {
        // This is a move. // 这是一个移动
        newFiber.flags |= Placement | PlacementDEV;
        return lastPlacedIndex;
      } else {
        // This item can stay in place. // 这一项可以呆在这个位置
        return oldIndex;
      }
    } else {
      // This is an insertion. // 这是一个插入
      newFiber.flags |= Placement | PlacementDEV;
      return lastPlacedIndex;
    }
  }
      */

      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber;
      }

      previousNewFiber = newFiber;
      oldFiber = nextOldFiber; // 为下一个fiber
    }

    // 如果说上面的for循环平安执行完毕，那么说明都已复用完毕或者创建新的完毕（收集老的完毕）
    // 那么对于老的剩余的直接删除收集即可

    // 上述循环结束后newIdx等于了新孩子的长度 - 说明新孩子已经遍历完毕
    if (newIdx === newChildren.length) {
      // 我们已经到了新孩子的尽头。我们可以删除其余的。
      // We've reached the end of the new children. We can delete the rest.
      deleteRemainingChildren(returnFiber, oldFiber); // 删除其余的孩子

      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild; // 返回
    }

    // 到这里的话说明中间遇到了key不相同的了 或者 oldFiber为null

    // 那么对于oldFiber为null则采取的直接是节点的新增

    // 新的节点的新增 // +++++++++++++++++++++++++++++++++++++++++++++++++++
    // 'count is '对应的fiber以及0对应的fiber创建出来 - 并且'count is '的fiber的sibling指向它 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    if (oldFiber === null) { // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; newIdx < newChildren.length; newIdx++) {
        const newFiber = createChild(returnFiber, newChildren[newIdx], lanes); // ++++++++++++++++++++++++++++++++++++++
        if (newFiber === null) {
          continue;
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx); // ++++++++++++++++++++++++++++++++++
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber; // +++++++++++++++++++++++++++++++++++++++++++++++++
        }
        previousNewFiber = newFiber;
      }
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild; // 返回'count is '这个fiber // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    }

    // 将所有的孩子添加到一个key map中以便于快速查找
    // Add all children to a key map for quick lookups.
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber); // 映射剩余的孩子 // +++++++++++++++++++++++++++++++++++++++++++
    // 优先级key > index
    /* 
      function mapRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber,
  ): Map<string | number, Fiber> {
    // Add the remaining children to a temporary map so that we can find them by
    // keys quickly. Implicit (null) keys get added to this set with their index
    // instead.
    const existingChildren: Map<string | number, Fiber> = new Map();

    let existingChild: null | Fiber = currentFirstChild;
    while (existingChild !== null) {
      if (existingChild.key !== null) {
        existingChildren.set(existingChild.key, existingChild);
      } else {
        existingChildren.set(existingChild.index, existingChild);
      }
      existingChild = existingChild.sibling;
    }
    return existingChildren;
  }
    */

    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // 以带key为例子之前是1 2 3
    // 现在是3 1 2
    // 你会发现1 2都需要移动，而3不需要移动
    // 所以尽量避免将尾部的向前移动
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // 继续扫描并使用map将已删除的项目恢复为移动。
    // Keep scanning and use the map to restore deleted items as moves.
    for (; newIdx < newChildren.length; newIdx++) { // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      const newFiber = updateFromMap(
        existingChildren, // map
        returnFiber,
        newIdx,
        newChildren[newIdx],
        lanes,
      );
/**
 * 
 *   function updateFromMap(
    existingChildren: Map<string | number, Fiber>,
    returnFiber: Fiber,
    newIdx: number,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number'
    ) {
      // Text nodes don't have keys, so we neither have to check the old nor
      // new node for the key. If both are text nodes, they match.
      const matchedFiber = existingChildren.get(newIdx) || null;
      return updateTextNode(returnFiber, matchedFiber, '' + newChild, lanes);
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null;
          return updateElement(returnFiber, matchedFiber, newChild, lanes);
        }
        case REACT_PORTAL_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null;
          return updatePortal(returnFiber, matchedFiber, newChild, lanes);
        }
        case REACT_LAZY_TYPE:
          const payload = newChild._payload;
          const init = newChild._init;
          return updateFromMap(
            existingChildren,
            returnFiber,
            newIdx,
            init(payload),
            lanes,
          );
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        const matchedFiber = existingChildren.get(newIdx) || null;
        return updateFragment(returnFiber, matchedFiber, newChild, lanes, null);
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }

 * 
 */

      if (newFiber !== null) {
        if (shouldTrackSideEffects) {
          if (newFiber.alternate !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(
              newFiber.key === null ? newIdx : newFiber.key,
            );
          }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx); // +++++++++++++++++++++++++++++++++++++++++++++
        /* 
          function placeChild(
            newFiber: Fiber,
            lastPlacedIndex: number,
            newIndex: number,
          ): number {
            newFiber.index = newIndex;
            if (!shouldTrackSideEffects) {
              // During hydration, the useId algorithm needs to know which fibers are
              // part of a list of children (arrays, iterators).
              newFiber.flags |= Forked;
              return lastPlacedIndex;
            }
            const current = newFiber.alternate;
            if (current !== null) {
              const oldIndex = current.index;
              if (oldIndex < lastPlacedIndex) {
                // This is a move.
                newFiber.flags |= Placement | PlacementDEV;
                return lastPlacedIndex;
              } else {
                // This item can stay in place.
                return oldIndex;
              }
            } else {
              // This is an insertion.
              newFiber.flags |= Placement | PlacementDEV;
              return lastPlacedIndex;
            }
          }
        */


        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (shouldTrackSideEffects) {
      // 删除上面没有使用的所有现有子节点。我们需要把它们添加到删除列表中。
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      existingChildren.forEach(child => deleteChild(returnFiber, child)); // 当前map中还存在的那么是直接删除 - 因为上面没有复用到
    }

    if (getIsHydrating()) {
      const numberOfForks = newIdx;
      pushTreeFork(returnFiber, numberOfForks);
    }

    // +++
    return resultingFirstChild;
  }

  // 调和孩子迭代器 // +++
  function reconcileChildrenIterator(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildrenIterable: Iterable<mixed>,
    lanes: Lanes,
  ): Fiber | null {
    // This is the same implementation as reconcileChildrenArray(),
    // but using the iterator instead.

    const iteratorFn = getIteratorFn(newChildrenIterable);

    if (typeof iteratorFn !== 'function') {
      throw new Error(
        'An object is not an iterable. This error is likely caused by a bug in ' +
          'React. Please file an issue.',
      );
    }

    if (__DEV__) {
      // We don't support rendering Generators because it's a mutation.
      // See https://github.com/facebook/react/issues/12995
      if (
        typeof Symbol === 'function' &&
        // $FlowFixMe Flow doesn't know about toStringTag
        newChildrenIterable[Symbol.toStringTag] === 'Generator'
      ) {
        if (!didWarnAboutGenerators) {
          console.error(
            'Using Generators as children is unsupported and will likely yield ' +
              'unexpected results because enumerating a generator mutates it. ' +
              'You may convert it to an array with `Array.from()` or the ' +
              '`[...spread]` operator before rendering. Keep in mind ' +
              'you might need to polyfill these features for older browsers.',
          );
        }
        didWarnAboutGenerators = true;
      }

      // Warn about using Maps as children
      if ((newChildrenIterable: any).entries === iteratorFn) {
        if (!didWarnAboutMaps) {
          console.error(
            'Using Maps as children is not supported. ' +
              'Use an array of keyed ReactElements instead.',
          );
        }
        didWarnAboutMaps = true;
      }

      // First, validate keys.
      // We'll get a different iterator later for the main pass.
      const newChildren = iteratorFn.call(newChildrenIterable);
      if (newChildren) {
        let knownKeys = null;
        let step = newChildren.next();
        for (; !step.done; step = newChildren.next()) {
          const child = step.value;
          knownKeys = warnOnInvalidKey(child, knownKeys, returnFiber);
        }
      }
    }

    const newChildren = iteratorFn.call(newChildrenIterable);

    if (newChildren == null) {
      throw new Error('An iterable object provided no iterator.');
    }

    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber = null;

    let step = newChildren.next();
    for (
      ;
      oldFiber !== null && !step.done;
      newIdx++, step = newChildren.next()
    ) {
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFiber = updateSlot(returnFiber, oldFiber, step.value, lanes);
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break;
      }
      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          deleteChild(returnFiber, oldFiber);
        }
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }

    if (step.done) {
      // We've reached the end of the new children. We can delete the rest.
      deleteRemainingChildren(returnFiber, oldFiber);
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; !step.done; newIdx++, step = newChildren.next()) {
        const newFiber = createChild(returnFiber, step.value, lanes);
        if (newFiber === null) {
          continue;
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    // Add all children to a key map for quick lookups.
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    for (; !step.done; newIdx++, step = newChildren.next()) {
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        step.value,
        lanes,
      );
      if (newFiber !== null) {
        if (shouldTrackSideEffects) {
          if (newFiber.alternate !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(
              newFiber.key === null ? newIdx : newFiber.key,
            );
          }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      existingChildren.forEach(child => deleteChild(returnFiber, child));
    }

    if (getIsHydrating()) {
      const numberOfForks = newIdx;
      pushTreeFork(returnFiber, numberOfForks);
    }
    return resultingFirstChild;
  }

  /* 
  简化版概括

  if currentFirstChild不为null 且 它到的tag是HostText
    则对currentFirstChild的sibling采用deleteRemainingChildren策略，然后对textContent使用createFiberFromText策略 - return
  直接对currentFirstChild采用deleteRemainingChildren，然后对textContent使用createFiberFromText策略 - return
  */
  // 调和单文本节点 // +++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  function reconcileSingleTextNode(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    textContent: string,
    lanes: Lanes,
  ): Fiber {
    // 没有必要检查文本节点上的key，因为我们没有方法来定义它们。
    // There's no need to check for keys on text nodes since we don't have a
    // way to define them.
    if (currentFirstChild !== null && currentFirstChild.tag === HostText) {
      // 我们已经有了一个现有的节点，所以我们只需要更新它并删除其余的。
      // We already have an existing node so let's just update it and delete
      // the rest.
      deleteRemainingChildren(returnFiber, currentFirstChild.sibling);
      const existing = useFiber(currentFirstChild, textContent);
      existing.return = returnFiber;
      return existing;
    }

    // 现有的第一个子节点不是文本节点，因此需要创建一个并删除现有的子节点。
    // The existing first child is not a text node so we need to create one
    // and delete the existing ones.
    deleteRemainingChildren(returnFiber, currentFirstChild);
    const created = createFiberFromText(textContent, returnFiber.mode, lanes); // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    created.return = returnFiber;
    return created; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  }

  // 单节点的diff
  /* 
  简化版概括

  child -> currentFirstChild

  while child !== null
    对比child和element之间的key
      if 一样还需要比对它们的elementType（就是createElement的参数type）
        if 一样则直接对child的sibling采用deleteRemainingChildren策略（这个参数是child的sibling，要注意！！！），然后对这个child采用useFiber的策略 - return
        不一样则直接对child采用deleteRemainingChildren策略（这个参数是child，它是对参数child以及它的sibling都进行一一删除的） - break
      else 若key不一样则直接对child采用deleteChild策略（注意是deleteChild策略 - 它是只删除这个参数child）
    child -> child.sibling
  
  while循环结束
  
  只要到了这里那么直接对element采用createFiberFromElement策略 - return
  */
  
  /* 
  useFiber的整体流程

  // 检查参数fiber的alternate是否存在
  //   若没有则按照此fiber的属性创建一个新的FiberNode，同时使其之间通过alternate属性相互进行关联
  //   若有则直接使用这个alternate对应的FiberNode，同时按照此参数fiber的属性更新到这个FiberNode上
  // 这里额外的事情就是让其index为0，sibling为null
  // 最终返回这个FiberNode
  */
  
  // 调和单元素
  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  function reconcileSingleElement( // +++
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    element: ReactElement,
    lanes: Lanes,
  ): Fiber {
    const key = element.key; // 取出vnode上的key属性
    let child = currentFirstChild; // current.child // +++

    // +++
    // 注意：这里循环的是current的child // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    while (child !== null) { // while循环 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      // 先比较key是否相同 // +++
      if (child.key === key) { // +++
        const elementType = element.type; // 取出vnode上的类型 // +++
        if (elementType === REACT_FRAGMENT_TYPE) { // +++
          if (child.tag === Fragment) { // +++
            deleteRemainingChildren(returnFiber, child.sibling); // +++
            const existing = useFiber(child, element.props.children); // +++
            existing.return = returnFiber; // +++
            if (__DEV__) {
              existing._debugSource = element._source;
              existing._debugOwner = element._owner;
            }
            return existing;
          }
        } else {
          if (
            child.elementType === elementType || // 元素类型一致 // +++
            // Keep this check inline so it only runs on the false path:
            (__DEV__
              ? isCompatibleFamilyForHotReloading(child, element)
              : false) ||
            // Lazy types should reconcile their resolved type.
            // We need to do this after the Hot Reloading check above,
            // because hot reloading has different semantics than prod because
            // it doesn't resuspend. So we can't let the call below suspend.
            (typeof elementType === 'object' && // +++
              elementType !== null &&
              elementType.$$typeof === REACT_LAZY_TYPE && // +++
              /** 重点！！！ */ resolveLazy(elementType) === child.type) // +++
          ) {
            // 删除其余的孩子
            // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
            // ++++++
            deleteRemainingChildren(returnFiber, child.sibling); // 【这个是child的sibling】 - （注意：但是当前函数是reconcileSingleElement，那么它以前有兄弟节点的话是要删除的）
            // ++++++
            // 而现在是一个单节点，以前（屏幕上出现的是current）是多个那么就需要把之前的兄弟节点全部删除的，所以这里有一个这样的步骤 // +++++++++++++++++++++++++++++++++++++++++++++
            /* 
              function deleteRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
  ): null {
    if (!shouldTrackSideEffects) {
      // Noop.
      return null;
    }

    // TODO: For the shouldClone case, this could be micro-optimized a bit by
    // assuming that after the first child we've already added everything.
    let childToDelete = currentFirstChild;
    while (childToDelete !== null) {
      deleteChild(returnFiber, childToDelete);
      childToDelete = childToDelete.sibling;
    }
    return null;
  }
            */

            const existing = useFiber(child, element.props); // 复用这个current fiber的alternate // ++++++++++++++++++++++++++++++++++++++++++++++++++++++
            /* 
              function useFiber(fiber: Fiber, pendingProps: mixed): Fiber {
    // We currently set sibling to null and index to 0 here because it is easy
    // to forget to do before returning it. E.g. for the single child case.
    const clone = createWorkInProgress(fiber, pendingProps); // 返回的是fiber.alternate // workInProgress.pendingProps = pendingProps; // ++++++++++++++++++++++++++++++++
    // packages/react-reconciler/src/ReactFiber.new.js -> createWorkInProgress -> workInProgress.pendingProps = pendingProps; // ++++++++++++++++++++++++++++++++++++++++
    // 就是vnode的props属性 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    clone.index = 0;
    clone.sibling = null;
    return clone;
  }
            */

            existing.ref = coerceRef(returnFiber, child, element);

            existing.return = returnFiber; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
            if (__DEV__) {
              existing._debugSource = element._source;
              existing._debugOwner = element._owner;
            }

            // +++
            return existing; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
          }
        }

        // 不匹配。
        // Didn't match.
        // ++++++
        deleteRemainingChildren(returnFiber, child); // 这个是child // ++++++++++++++++++++++++++++
        break; // 退出while循环 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      } else {

        // key不一致则删除孩子 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        deleteChild(returnFiber, child);
        /* 
          function deleteChild(returnFiber: Fiber, childToDelete: Fiber): void {
    if (!shouldTrackSideEffects) {
      // Noop.
      return;
    }
    const deletions = returnFiber.deletions;
    if (deletions === null) {
      returnFiber.deletions = [childToDelete];
      returnFiber.flags |= ChildDeletion; // 孩子删除标记 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    } else {
      deletions.push(childToDelete);
    }
  }
        */
      }

      // +++
      // +++
      child = child.sibling; // +++
    }


    if (element.type === REACT_FRAGMENT_TYPE) {
      // 创建一个关于fragment的FiberNode
      const created = createFiberFromFragment(
        element.props.children,
        returnFiber.mode,
        lanes,
        element.key,
      );
      created.return = returnFiber;
      return created;
    } else {
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
      // ./ReactFiber.new.js
      // ++++++
      const created = createFiberFromElement(element, returnFiber.mode, lanes); // 从元素创建fiber

      // 对于函数式组件中使用useRef来讲 - <div ref={myRef}></div>
      // 那么这个函数的返回值就是element.ref - 也就是这个{current: initialValue}
      created.ref = coerceRef(returnFiber, currentFirstChild, element);
      // 那么这个fiber的ref属性就赋值这个对象了 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      
      
      created.return = returnFiber; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      return created; // 返回这个fiber
    }
  }

  // 调和单portal
  // +++
  function reconcileSinglePortal(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    portal: ReactPortal,
    lanes: Lanes,
  ): Fiber {
    const key = portal.key;
    let child = currentFirstChild;
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      if (child.key === key) {
        if (
          child.tag === HostPortal &&
          child.stateNode.containerInfo === portal.containerInfo &&
          child.stateNode.implementation === portal.implementation
        ) {
          deleteRemainingChildren(returnFiber, child.sibling);
          const existing = useFiber(child, portal.children || []);
          existing.return = returnFiber;
          return existing;
        } else {
          deleteRemainingChildren(returnFiber, child);
          break;
        }
      } else {
        deleteChild(returnFiber, child);
      }
      child = child.sibling;
    }

    // 从portal创建对应的fiber // +++
    const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
    created.return = returnFiber;

    // 返回这个fiber // +++
    return created;
  }

  // reconcileChildFibers这个函数是按照newChild来去判断到底是reconcile哪一种策略 // +++

  // 调和子fibers
  // This API will tag the children with the side-effect of the reconciliation
  // itself. They will be added to the side-effect list as we pass through the
  // children and the parent.
  // +++
  function reconcileChildFibers( // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // This function is not recursive.
    // If the top level item is an array, we treat it as a set of children,
    // not as a fragment. Nested arrays on the other hand will be treated as
    // fragment nodes. Recursion happens at the normal flow.

    // Handle top level unkeyed fragments as if they were arrays.
    // This leads to an ambiguity between <>{[...]}</> and <>...</>.
    // We treat the ambiguous cases above the same.
    const isUnkeyedTopLevelFragment = // 是否为没有key的顶级fragment // +++++++++++++++++++++++++++++++++++++++++++++++++
      typeof newChild === 'object' &&
      newChild !== null &&
      newChild.type === REACT_FRAGMENT_TYPE &&
      newChild.key === null;
    if (isUnkeyedTopLevelFragment) { // 如果是则取出它的孩子即可 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      newChild = newChild.props.children;
      // 是不带有key的顶级fragment - 那么直接取出它的children属性作为本次的newChild
      /* 
      所以你就会看到
      比如：
      function App() {
        return (
          <>
            <h2></h2>
            ...
          </>
        )
      }
      那么App fiber的child直接是h2 fiber啦 - 要注意！！！
      // 这个就直接省略了fragment对应的fiber了直接略过它 - 而是直接使用它的孩子作为直接的fiber - 要注意的！！！

      而对于其他的
      比如
      return (
        <Fragment key={xxx}>
        
        </Fragment>
      )

      return (
        <div>
          <>
            123
          </>
        </div>
      )
      // 以上这些都是会有对应的fragment的fiber的

      */
    }

    // 对newChild的类型做出判断 // +++
    // 主要还是packages/react-reconciler/src/ReactFiber.new.js下的类似于createFiberFromElement的api // +++
    // 具体可以看下面不同的判断对应的分支逻辑 // +++

    // 处理对象类型 // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    // Handle object types
    if (typeof newChild === 'object' && newChild !== null) { // +++
      switch (newChild.$$typeof) { // +++
        // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        case REACT_ELEMENT_TYPE: // App | button
          // +++
          return placeSingleChild( // 重点+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++=
            // +++
            reconcileSingleElement( // 重点++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
              returnFiber,
              currentFirstChild,
              newChild,
              lanes,
            ), // +++
          );
        /* 
        createPortal api返回的对象
          return {
            // This tag allow us to uniquely identify this as a React Portal
            $$typeof: REACT_PORTAL_TYPE,
            key: key == null ? null : '' + key,
            children,
            containerInfo,
            implementation,
          };
        */
        case REACT_PORTAL_TYPE:

          // 这个HostPortal对应的fiber的tag是否加上Placement将根据它的父级到底是reconcileChildFibers还是mountChildFibers
          // 那么不管啊它的flags是否加上这个Placement标记 - 那么在commitMutationEffects中的case HostPortal: commitReconciliationEffects
          // 这个里面我们最终跟到里面看了下发现什么事情都是不做的

          // 那么如何挂载呢？
          // 最关键的地方还是在于beginWork中的updatePortalComponent中的workInProgress.child = reconcileChildFibers(...)
          // 这个直接影响它的children的flags是否带有Placement标记所以它才是最关键的因素 // ！！！
          return placeSingleChild( // +++

            // +++
            reconcileSinglePortal(
              returnFiber,
              currentFirstChild,
              newChild,
              lanes,
            ),
          );
        case REACT_LAZY_TYPE: // +++
          const payload = newChild._payload; // +++
          const init = newChild._init; // +++
          // TODO: This function is supposed to be non-recursive.
          return reconcileChildFibers(
            returnFiber,
            currentFirstChild,
            init(payload), // +++ // 报错 - 抛出的是一个promise - 那么又到handleThrow中了 -> workLoopSync -> resumeSuspendedUnitOfWork
            lanes,
          );
      }

      // +++
      // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      if (isArray(newChild)) { // ['count is ', 0]
        // 注意：没有placeSingleChild方法的执行的 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        return reconcileChildrenArray( // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++=++++++++++++++++++++++++++++++++++++++++++
          returnFiber,
          currentFirstChild,
          newChild,
          lanes,
        ); // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
      }

      // +++
      if (getIteratorFn(newChild)) {
        return reconcileChildrenIterator(
          returnFiber,
          currentFirstChild,
          newChild,
          lanes,
        );
      }

      // +++
      throwOnInvalidObjectType(returnFiber, newChild);
    }

    // +++
    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number'
    ) {
      return placeSingleChild( // +++
        // +++
        reconcileSingleTextNode( // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
          returnFiber,
          currentFirstChild,
          '' + newChild,
          lanes,
        ),
      );
    }

    // +++
    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    // +++
    // 其余的案例都被视为空。 // ++++++++++++++++++++++++++++++++++++++++++++++
    // Remaining cases are all treated as empty.
    return deleteRemainingChildren(returnFiber, currentFirstChild); // +++
  }

  return reconcileChildFibers; // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
}

// 调和子fibers
// +++
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export const reconcileChildFibers: ChildReconciler = createChildReconciler(
  // +++ 表示应该收集副作用
  true, // 传入true参数 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
);

// 它俩之间的区别在于通过createChildReconciler函数执行时传入的参数shouldTrackSideEffects一个是true，一个是false

// 挂载子fibers
// +++
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
export const mountChildFibers: ChildReconciler = createChildReconciler(false /** ++表示不应该进行收集++ */); // 传入false // +++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// 克隆孩子fiber
export function cloneChildFibers(
  current: Fiber | null,
  workInProgress: Fiber,
): void {
  if (current !== null && workInProgress.child !== current.child) {
    throw new Error('Resuming work not yet implemented.');
  }

  if (workInProgress.child === null) {
    return;
  }

  // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // 注意：这个是current的child，因为在prepareFreshStack中使wip复用current属性了，所以wip的child是指向current的，那么这里直接让wip的child指向了current的child的alternate啦 ~ // +++++
  let currentChild = workInProgress.child; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  let newChild = createWorkInProgress(currentChild, currentChild.pendingProps); // ++++++++++++++++++++++++++++++++++++++++++++++++++
  workInProgress.child = newChild; // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  newChild.return = workInProgress;
  while (currentChild.sibling !== null) {
    currentChild = currentChild.sibling;
    newChild = newChild.sibling = createWorkInProgress(
      currentChild,
      currentChild.pendingProps,
    );
    newChild.return = workInProgress;
  }
  newChild.sibling = null;
}

// Reset a workInProgress child set to prepare it for a second pass.
export function resetChildFibers(workInProgress: Fiber, lanes: Lanes): void {
  let child = workInProgress.child;
  while (child !== null) {
    resetWorkInProgress(child, lanes);
    child = child.sibling;
  }
}
