/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactContext, ReactProviderType} from 'shared/ReactTypes';
import type {
  Fiber,
  ContextDependency,
  Dependencies,
} from './ReactInternalTypes';
import type {StackCursor} from './ReactFiberStack.new';
import type {Lanes} from './ReactFiberLane.new';
import type {SharedQueue} from './ReactFiberClassUpdateQueue.new';

import {isPrimaryRenderer} from './ReactFiberHostConfig';
import {createCursor, push, pop} from './ReactFiberStack.new';
import {
  ContextProvider,
  ClassComponent,
  DehydratedFragment,
} from './ReactWorkTags';
import {
  NoLanes,
  NoTimestamp,
  isSubsetOfLanes,
  includesSomeLane,
  mergeLanes,
  pickArbitraryLane,
} from './ReactFiberLane.new';
import {
  NoFlags,
  DidPropagateContext,
  NeedsPropagation,
} from './ReactFiberFlags';

import is from 'shared/objectIs';
import {createUpdate, ForceUpdate} from './ReactFiberClassUpdateQueue.new';
import {markWorkInProgressReceivedUpdate} from './ReactFiberBeginWork.new';
import {
  enableLazyContextPropagation,
  enableServerContext,
} from 'shared/ReactFeatureFlags';
import {REACT_SERVER_CONTEXT_DEFAULT_VALUE_NOT_LOADED} from 'shared/ReactSymbols';

// 创建一个value游标 // +++
const valueCursor: StackCursor<mixed> = createCursor(null); // +++

let rendererSigil;
if (__DEV__) {
  // Use this to detect multiple renderers using the same context
  rendererSigil = {};
}

let currentlyRenderingFiber: Fiber | null = null;

let lastContextDependency: ContextDependency<mixed> | null = null; // 默认为null // +++
// 它在prepareToReadContext函数中也是置为null的

let lastFullyObservedContext: ReactContext<any> | null = null;

let isDisallowedContextReadInDEV: boolean = false;

// 重置上下文依赖 - 这个函数在renderRootConcurrent和renderRootSync中调用
// 它们都是在各自的workLoopConcurrent和workLoopSync函数之前完毕之后调用的 // 注意！！！
export function resetContextDependencies(): void {
  // This is called right before React yields execution, to ensure `readContext`
  // cannot be called outside the render phase.
  currentlyRenderingFiber = null;
  lastContextDependency = null; // 设置为null // +++
  lastFullyObservedContext = null;
  if (__DEV__) {
    isDisallowedContextReadInDEV = false;
  }
}

export function enterDisallowedContextReadInDEV(): void {
  if (__DEV__) {
    isDisallowedContextReadInDEV = true;
  }
}

export function exitDisallowedContextReadInDEV(): void {
  if (__DEV__) {
    isDisallowedContextReadInDEV = false;
  }
}

// 推入提供者 // +++
export function pushProvider<T>(
  providerFiber: Fiber,
  context: ReactContext<T>,
  nextValue: T,
): void {
  // packages/react-dom-bindings/src/client/ReactDOMHostConfig.js中的isPrimaryRenderer是一直为true的
  if (isPrimaryRenderer) { // true

    // packages/react-reconciler/src/ReactFiberStack.new.js
    // 上面创建value游标
    push(valueCursor, context._currentValue, providerFiber); // 上下文对象中的_currentValue属性值 - 之前的值
    // 使用valueStack保存值游标的值（旧值），然后把游标的current赋值为context._currentValue（下一个旧值） // +++
    // 游标右移

    // valueStack保存的是context._currentValue之前的值

    // 把这个react元素的props对象中的value属性值存入这个context中的_currentValue属性中（新值） // +++
    context._currentValue = nextValue; // 存入新的值 // +++
    if (__DEV__) {
      if (
        context._currentRenderer !== undefined &&
        context._currentRenderer !== null &&
        context._currentRenderer !== rendererSigil
      ) {
        console.error(
          'Detected multiple renderers concurrently rendering the ' +
            'same context provider. This is currently unsupported.',
        );
      }
      context._currentRenderer = rendererSigil;
    }
  } else {
    push(valueCursor, context._currentValue2, providerFiber);

    context._currentValue2 = nextValue;
    if (__DEV__) {
      if (
        context._currentRenderer2 !== undefined &&
        context._currentRenderer2 !== null &&
        context._currentRenderer2 !== rendererSigil
      ) {
        console.error(
          'Detected multiple renderers concurrently rendering the ' +
            'same context provider. This is currently unsupported.',
        );
      }
      context._currentRenderer2 = rendererSigil;
    }
  }
}

// 弹出提供者 - 在completeWork中case ContextProvider:中进行的 // +++
export function popProvider(
  context: ReactContext<any>,
  providerFiber: Fiber,
): void {

  // 获取context._currentValue之前的值（旧值） // +++
  const currentValue = valueCursor.current; // +++

  // +++
  pop(valueCursor, providerFiber); // 这一步就是把context._currentValue之前的值存储到值游标的current上 // +++
  // 游标左移 - 上一个旧值
  
  if (isPrimaryRenderer) { // true
    if (
      enableServerContext &&
      currentValue === REACT_SERVER_CONTEXT_DEFAULT_VALUE_NOT_LOADED
    ) {
      context._currentValue = context._defaultValue;
    } else {
    
      // 恢复为在context._currentValue进行pushProvider时期保存的之前的值（旧值）
      // +++
      context._currentValue = currentValue; // +++
    
    }
  } else {
    if (
      enableServerContext &&
      currentValue === REACT_SERVER_CONTEXT_DEFAULT_VALUE_NOT_LOADED
    ) {
      context._currentValue2 = context._defaultValue;
    } else {
      context._currentValue2 = currentValue;
    }
  }
}

// 在父路径调度上下文工作 // +++
export function scheduleContextWorkOnParentPath(
  parent: Fiber | null,
  renderLanes: Lanes,
  propagationRoot: Fiber,
) {
  // 更新所有的祖先的childLanes（包括alternates）
  // Update the child lanes of all the ancestors, including the alternates.
  let node = parent;
  while (node !== null) {
    const alternate = node.alternate;
    if (!isSubsetOfLanes(node.childLanes, renderLanes)) {
      node.childLanes = mergeLanes(node.childLanes, renderLanes);
      if (alternate !== null) {
        alternate.childLanes = mergeLanes(alternate.childLanes, renderLanes);
      }
    } else if (
      alternate !== null &&
      !isSubsetOfLanes(alternate.childLanes, renderLanes)
    ) {
      alternate.childLanes = mergeLanes(alternate.childLanes, renderLanes);
    } else {
      // Neither alternate was updated.
      // Normally, this would mean that the rest of the
      // ancestor path already has sufficient priority.
      // However, this is not necessarily true inside offscreen
      // or fallback trees because childLanes may be inconsistent
      // with the surroundings. This is why we continue the loop.
    }

    // +++
    if (node === propagationRoot) { // +++
      break; // 到propagationRoot这里结束 // +++
    }
    
    node = node.return;
  }
  if (__DEV__) {
    if (node !== propagationRoot) {
      console.error(
        'Expected to find the propagation root when scheduling context work. ' +
          'This error is likely caused by a bug in React. Please file an issue.',
      );
    }
  }
}

// 传播上下文变化 // +++
export function propagateContextChange<T>(
  workInProgress: Fiber,
  context: ReactContext<T>,
  renderLanes: Lanes,
): void {
  if (enableLazyContextPropagation) {
    // TODO: This path is only used by Cache components. Update
    // lazilyPropagateParentContextChanges to look for Cache components so they
    // can take advantage of lazy propagation.
    const forcePropagateEntireTree = true;
    propagateContextChanges(
      workInProgress,
      [context],
      renderLanes,
      forcePropagateEntireTree,
    );
  } else {

    // 立即传播上下文变化 // +++
    propagateContextChange_eager(workInProgress, context, renderLanes);
  }
}

// 立即传播上下文变化 // +++
/* 
这个函数主要就是迭代遍历Provider对应的wip fiber的children - 注意此时应该是current fiber的children
<XxxContext.Provider>
  xxx1
  xxx2
  xxx3
</XxxContext.Provider>
且是深度优先遍历 - 以至于遍历以Provider开始的整棵树
查找以下消费者对应的current fiber
updateCacheComponent -> readContext
updateFunctionComponent中使用useContext -> readContext
updateContextConsumer -> readContext
updateClassComponent -> mountClassInstance -> readContext
updateClassComponent -> updateClassInstance -> readContext

找到这些

把这些current fiber的lanes与renderLanes做或|运算，当然还有它们对应的alternate fiber的lanes也是如此
此外还有current fiber的dependencies上的lanes也是如此
当然还要把current fiber的祖先parent父级的childLanes也是一样 - 还包括对应的alternate fiber的childLanes（【但是要注意它只到Provider对应的wip fiber这里就结束了，不会再向上了】 // +++）

注意因当前阶段处于render阶段中的beginWork
那么在completeWork时期是有bubbleProperties的 - 它主要是针对其wip fiber的childLanes的

所以在commit阶段的commitRootImpl时
  ...
  let remainingLanes = mergeLanes(finishedWork.lanes, finishedWork.childLanes);
  ...
  markRootFinished(root, remainingLanes);
    ...
    root.pendingLanes = remainingLanes;
    ...
  ...
  root.current = finishedWork; // ++++++
  ...
  ensureRootIsScheduled(root, now()); // +++
  ...
对于remainingLanes来讲就会有剩余的 - 那么所以就会再去进行调度一次 - ensureRootIsScheduled函数执行 // +++
那么在又一次的过程中的beginWork
  updateContextProvider -> 新旧值没有变化便直接bailoutOnAlreadyFinishedWork（具体查看updateContextProvider此函数）
！！！
*/
function propagateContextChange_eager<T>(
  workInProgress: Fiber,
  context: ReactContext<T>,
  renderLanes: Lanes,
): void {
  // Only used by eager implementation
  if (enableLazyContextPropagation) {
    return;
  }
  
  let fiber = workInProgress.child; // 取出当前<XxxContext.Provider>对应wip fiber的child - 【注意它还是复用的current的child】 // +++

  if (fiber !== null) {
    // Set the return pointer of the child to the work-in-progress fiber.
    fiber.return = workInProgress; // 把current的child的return设置为wip // +++
  }

  // while循环
  while (fiber !== null) {
    let nextFiber;

    // 拜访这个fiber // +++
    // Visit this fiber.
    const list = fiber.dependencies; // 取出这个fiber的dependencies属性


    // 这个fiber是否有dependencies - 【这个dependencies只有在执行readContext函数才会有的】 // +++
    /* 
    updateCacheComponent -> readContext
    updateFunctionComponent中使用useContext -> readContext
    updateContextConsumer -> readContext
    updateClassComponent -> mountClassInstance -> readContext
    updateClassComponent -> updateClassInstance -> readContext

    // 暂时发现这些！
    */
    if (list !== null) {
      nextFiber = fiber.child; // 再取出这个fiber的child作为下一个fiber // +++

      let dependency = list.firstContext; // 上下文单向链表中的第一个上下文对象

      while (dependency !== null) {
        // Check if the context matches.
        if (dependency.context === context) { // 检查这个context是否一致
          // Match! Schedule an update on this fiber.
          if (fiber.tag === ClassComponent) {

            // 在这个wip上调度一个强制更新 // +++
            
            // Schedule a force update on the work-in-progress.
            const lane = pickArbitraryLane(renderLanes);
            const update = createUpdate(NoTimestamp, lane);
            update.tag = ForceUpdate; // 强制更新 // +++

            // TODO: Because we don't have a work-in-progress, this will add the
            // update to the current fiber, too, which means it will persist even if
            // this render is thrown away. Since it's a race condition, not sure it's
            // worth fixing.

            // Inlined `enqueueUpdate` to remove interleaved update check
            const updateQueue = fiber.updateQueue;
            if (updateQueue === null) {
              // Only occurs if the fiber has been unmounted.
            } else {
              const sharedQueue: SharedQueue<any> = (updateQueue: any).shared;
              const pending = sharedQueue.pending;
              if (pending === null) {
                // This is the first update. Create a circular list.
                update.next = update;
              } else {
                update.next = pending.next;
                pending.next = update;
              }
              // +++
              sharedQueue.pending = update;
            }
          }

          // 主要就是改变这个fiber的lanes
          fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
          const alternate = fiber.alternate;

          // 改变它的alternate的lanes
          if (alternate !== null) {
            alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
          }

          // 在父路径上调度上下文工作 // +++
          /* 
          // 更新所有的祖先的childLanes（包括alternates）
          */
          scheduleContextWorkOnParentPath(
            fiber.return,
            renderLanes,
            workInProgress,
          );

          // 也在list上标记更新的车道集合。
          // Mark the updated lanes on the list, too.
          list.lanes = mergeLanes(list.lanes, renderLanes);

          // 因为我们已经找到了匹配项，所以可以停止遍历依赖项列表。
          // Since we already found a match, we can stop traversing the
          // dependency list.
          break; // break退出当前while循环 // +++
        }

        // 单向链表的下一个上下文 // +++
        dependency = dependency.next;
      }
    } else if (fiber.tag === ContextProvider) {
      // 如果这是匹配的【提供者】，请不要深入扫描 // +++
      // Don't scan deeper if this is a matching provider
      nextFiber = fiber.type === workInProgress.type ? null : fiber.child; // +++
    } else if (fiber.tag === DehydratedFragment) {
      // If a dehydrated suspense boundary is in this subtree, we don't know
      // if it will have any context consumers in it. The best we can do is
      // mark it as having updates.
      const parentSuspense = fiber.return;

      if (parentSuspense === null) {
        throw new Error(
          'We just came from a parent so we must have had a parent. This is a bug in React.',
        );
      }

      parentSuspense.lanes = mergeLanes(parentSuspense.lanes, renderLanes);
      const alternate = parentSuspense.alternate;
      if (alternate !== null) {
        alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
      }
      // This is intentionally passing this fiber as the parent
      // because we want to schedule this fiber as having work
      // on its children. We'll use the childLanes on
      // this fiber to indicate that a context has changed.
      scheduleContextWorkOnParentPath(
        parentSuspense,
        renderLanes,
        workInProgress,
      );
      nextFiber = fiber.sibling;
    } else {
      // 向下迭代 - 可以看出是【深度优先遍历】
      // Traverse down.
      nextFiber = fiber.child; // +++
    }

    if (nextFiber !== null) {
      // 将child的return指针指向wip fiber // +++
      // Set the return pointer of the child to the work-in-progress fiber.
      nextFiber.return = fiber;
    } else {
      // 没有child那么迭代它的sibling
      // No child. Traverse to next sibling.
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === workInProgress) {
          // 我们回到这个子树的根。退出。 // +++
          // We're back to the root of this subtree. Exit.
          nextFiber = null;
          break;
        }
        const sibling = nextFiber.sibling; // 兄弟
        if (sibling !== null) {
          // 将child的return指针指向wip fiber // +++
          // Set the return pointer of the sibling to the work-in-progress fiber.
          sibling.return = nextFiber.return;
          nextFiber = sibling; // 替换为兄弟
          break;
        }
        // 没有更多的兄弟则向上迭代 // +++
        // No more siblings. Traverse up.
        nextFiber = nextFiber.return;
      }
    }

    // 把fiber替换为下一个fiber // +++
    fiber = nextFiber;
  }
  // +++

}

function propagateContextChanges<T>(
  workInProgress: Fiber,
  contexts: Array<any>,
  renderLanes: Lanes,
  forcePropagateEntireTree: boolean,
): void {
  // Only used by lazy implementation
  if (!enableLazyContextPropagation) {
    return;
  }
  let fiber = workInProgress.child;
  if (fiber !== null) {
    // Set the return pointer of the child to the work-in-progress fiber.
    fiber.return = workInProgress;
  }
  while (fiber !== null) {
    let nextFiber;

    // Visit this fiber.
    const list = fiber.dependencies;
    if (list !== null) {
      nextFiber = fiber.child;

      let dep = list.firstContext;
      findChangedDep: while (dep !== null) {
        // Assigning these to constants to help Flow
        const dependency = dep;
        const consumer = fiber;
        findContext: for (let i = 0; i < contexts.length; i++) {
          const context: ReactContext<T> = contexts[i];
          // Check if the context matches.
          // TODO: Compare selected values to bail out early.
          if (dependency.context === context) {
            // Match! Schedule an update on this fiber.

            // In the lazy implementation, don't mark a dirty flag on the
            // dependency itself. Not all changes are propagated, so we can't
            // rely on the propagation function alone to determine whether
            // something has changed; the consumer will check. In the future, we
            // could add back a dirty flag as an optimization to avoid double
            // checking, but until we have selectors it's not really worth
            // the trouble.
            consumer.lanes = mergeLanes(consumer.lanes, renderLanes);
            const alternate = consumer.alternate;
            if (alternate !== null) {
              alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
            }
            scheduleContextWorkOnParentPath(
              consumer.return,
              renderLanes,
              workInProgress,
            );

            if (!forcePropagateEntireTree) {
              // During lazy propagation, when we find a match, we can defer
              // propagating changes to the children, because we're going to
              // visit them during render. We should continue propagating the
              // siblings, though
              nextFiber = null;
            }

            // Since we already found a match, we can stop traversing the
            // dependency list.
            break findChangedDep;
          }
        }
        dep = dependency.next;
      }
    } else if (fiber.tag === DehydratedFragment) {
      // If a dehydrated suspense boundary is in this subtree, we don't know
      // if it will have any context consumers in it. The best we can do is
      // mark it as having updates.
      const parentSuspense = fiber.return;

      if (parentSuspense === null) {
        throw new Error(
          'We just came from a parent so we must have had a parent. This is a bug in React.',
        );
      }

      parentSuspense.lanes = mergeLanes(parentSuspense.lanes, renderLanes);
      const alternate = parentSuspense.alternate;
      if (alternate !== null) {
        alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
      }
      // This is intentionally passing this fiber as the parent
      // because we want to schedule this fiber as having work
      // on its children. We'll use the childLanes on
      // this fiber to indicate that a context has changed.
      scheduleContextWorkOnParentPath(
        parentSuspense,
        renderLanes,
        workInProgress,
      );
      nextFiber = null;
    } else {
      // Traverse down.
      nextFiber = fiber.child;
    }

    if (nextFiber !== null) {
      // Set the return pointer of the child to the work-in-progress fiber.
      nextFiber.return = fiber;
    } else {
      // No child. Traverse to next sibling.
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === workInProgress) {
          // We're back to the root of this subtree. Exit.
          nextFiber = null;
          break;
        }
        const sibling = nextFiber.sibling;
        if (sibling !== null) {
          // Set the return pointer of the sibling to the work-in-progress fiber.
          sibling.return = nextFiber.return;
          nextFiber = sibling;
          break;
        }
        // No more siblings. Traverse up.
        nextFiber = nextFiber.return;
      }
    }
    fiber = nextFiber;
  }
}

export function lazilyPropagateParentContextChanges(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const forcePropagateEntireTree = false;
  propagateParentContextChanges(
    current,
    workInProgress,
    renderLanes,
    forcePropagateEntireTree,
  );
}

// Used for propagating a deferred tree (Suspense, Offscreen). We must propagate
// to the entire subtree, because we won't revisit it until after the current
// render has completed, at which point we'll have lost track of which providers
// have changed.
export function propagateParentContextChangesToDeferredTree(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const forcePropagateEntireTree = true;
  propagateParentContextChanges(
    current,
    workInProgress,
    renderLanes,
    forcePropagateEntireTree,
  );
}

function propagateParentContextChanges(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
  forcePropagateEntireTree: boolean,
) {
  if (!enableLazyContextPropagation) {
    return;
  }

  // Collect all the parent providers that changed. Since this is usually small
  // number, we use an Array instead of Set.
  let contexts = null;
  let parent: null | Fiber = workInProgress;
  let isInsidePropagationBailout = false;
  while (parent !== null) {
    if (!isInsidePropagationBailout) {
      if ((parent.flags & NeedsPropagation) !== NoFlags) {
        isInsidePropagationBailout = true;
      } else if ((parent.flags & DidPropagateContext) !== NoFlags) {
        break;
      }
    }

    if (parent.tag === ContextProvider) {
      const currentParent = parent.alternate;

      if (currentParent === null) {
        throw new Error('Should have a current fiber. This is a bug in React.');
      }

      const oldProps = currentParent.memoizedProps;
      if (oldProps !== null) {
        const providerType: ReactProviderType<any> = parent.type;
        const context: ReactContext<any> = providerType._context;

        const newProps = parent.pendingProps;
        const newValue = newProps.value;

        const oldValue = oldProps.value;

        if (!is(newValue, oldValue)) {
          if (contexts !== null) {
            contexts.push(context);
          } else {
            contexts = [context];
          }
        }
      }
    }
    parent = parent.return;
  }

  if (contexts !== null) {
    // If there were any changed providers, search through the children and
    // propagate their changes.
    propagateContextChanges(
      workInProgress,
      contexts,
      renderLanes,
      forcePropagateEntireTree,
    );
  }

  // This is an optimization so that we only propagate once per subtree. If a
  // deeply nested child bails out, and it calls this propagation function, it
  // uses this flag to know that the remaining ancestor providers have already
  // been propagated.
  //
  // NOTE: This optimization is only necessary because we sometimes enter the
  // begin phase of nodes that don't have any work scheduled on them —
  // specifically, the siblings of a node that _does_ have scheduled work. The
  // siblings will bail out and call this function again, even though we already
  // propagated content changes to it and its subtree. So we use this flag to
  // mark that the parent providers already propagated.
  //
  // Unfortunately, though, we need to ignore this flag when we're inside a
  // tree whose context propagation was deferred — that's what the
  // `NeedsPropagation` flag is for.
  //
  // If we could instead bail out before entering the siblings' begin phase,
  // then we could remove both `DidPropagateContext` and `NeedsPropagation`.
  // Consider this as part of the next refactor to the fiber tree structure.
  workInProgress.flags |= DidPropagateContext;
}

export function checkIfContextChanged(
  currentDependencies: Dependencies,
): boolean {
  if (!enableLazyContextPropagation) {
    return false;
  }
  // Iterate over the current dependencies to see if something changed. This
  // only gets called if props and state has already bailed out, so it's a
  // relatively uncommon path, except at the root of a changed subtree.
  // Alternatively, we could move these comparisons into `readContext`, but
  // that's a much hotter path, so I think this is an appropriate trade off.
  let dependency = currentDependencies.firstContext;
  while (dependency !== null) {
    const context = dependency.context;
    const newValue = isPrimaryRenderer
      ? context._currentValue
      : context._currentValue2;
    const oldValue = dependency.memoizedValue;
    if (!is(newValue, oldValue)) {
      return true;
    }
    dependency = dependency.next;
  }
  return false;
}

// 准备去读取上下文 // +++
/* 
packages/react-reconciler/src/ReactFiberBeginWork.new.js
updateForwardRef
updateCacheComponent
updateFunctionComponent
updateClassComponent
mountIncompleteClassComponent
mountIndeterminateComponent
updateContextConsumer

以上是该函数的调用位置函数 // +++
*/
export function prepareToReadContext(
  workInProgress: Fiber,
  renderLanes: Lanes,
): void {
  // 给当前的这个变量赋值为wip // +++
  currentlyRenderingFiber = workInProgress;

  // 把lastContextDependency在这里置为null // +++
  lastContextDependency = null; // +++

  lastFullyObservedContext = null;

  // 在createWorkInProgress中wip的dependencies是浅克隆current的dependencies的

  // +++
  const dependencies = workInProgress.dependencies; // 浅克隆current的dependencies

  if (dependencies !== null) {
    if (enableLazyContextPropagation) {
      // Reset the work-in-progress list
      dependencies.firstContext = null;
    } else {

      const firstContext = dependencies.firstContext; // 第一个上下文

      if (firstContext !== null) {

        // dependencies.lanes在updateContextProvider中对于新旧value不一致时采取propagateContextChange，所以这里肯定是包含renderLanes // +++

        if (includesSomeLane(dependencies.lanes, renderLanes)) { // 车道集合是否包含渲染车道集合

          // 上下文单向链表有一个待处理的更新则标记这个wip fiber已执行了工作 // +++
          // Context list has a pending update. Mark that this fiber performed work.
          markWorkInProgressReceivedUpdate(); // 标记didReceiveUpdate这个全局变量为true

        }

        // +++
        // 重置这个指针指向null - 也就是丢弃浅克隆之前的上下文链表
        // Reset the work-in-progress list
        dependencies.firstContext = null; // 置为null // +++
      
      }

    }
  }
}

// 读取上下文函数
/* 
1. 对于useContext hook来讲主要是把context._currentValue给返回 - 它是在进行beginWork中的updateContextProvider中pushProvider中进行更新context._currentValue的
【另外就是会再形成一个context单向链表放在函数式组件对应的wip fiber的dependencies属性的firstContext属性上】 // +++

2.对于XxxContext.Consumer来讲它和useContext hook的逻辑是一样的 - 只不过它比较的全乎直接prepareToReadContext -> readContext
其它的逻辑可以查看它的beginWork -> updateContextConsumer

而useContext直接就是readContext - 那么对于该hook前面应该有的prepareToReadContext逻辑它是在mountIndeterminateComponent
还有updateFunctionComponent中进行的 - 其它关于prepareToReadContext函数调用处可以查看上面的注释，有详细的说明！！！


*/

// +++

// 这个fiber是否有dependencies - 【这个dependencies只有在执行readContext函数才会有的】 // +++
/* 
updateCacheComponent -> readContext
updateFunctionComponent中使用useContext -> readContext
updateContextConsumer -> readContext
updateClassComponent -> mountClassInstance -> readContext
updateClassComponent -> updateClassInstance -> readContext

// 暂时发现这些！
*/
export function readContext<T>(context: ReactContext<T>): T {
  if (__DEV__) {
    // This warning would fire if you read context inside a Hook like useMemo.
    // Unlike the class check below, it's not enforced in production for perf.
    if (isDisallowedContextReadInDEV) {
      console.error(
        'Context can only be read while React is rendering. ' +
          'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
          'In function components, you can read it directly in the function body, but not ' +
          'inside Hooks like useReducer() or useMemo().',
      );
    }
  }

  // ./ReactFiberHostConfig.js -> packages/react-dom-bindings/src/client/ReactDOMHostConfig.js -> true
  const value = isPrimaryRenderer
    ? context._currentValue // 取出上下文中的_currentValue作为value
    : context._currentValue2;

  if (lastFullyObservedContext === context) {
    // Nothing to do. We already observe everything in this context.
  } else {

    // 准备上下文对象
    const contextItem = {
      context: ((context: any): ReactContext<mixed>), // 存储context
      memoizedValue: value, // 上一次的值
      next: null, // next指针
    };

    // 代表最后一个上下文依赖
    // lastContextDependency默认为null
    if (lastContextDependency === null) {
      if (currentlyRenderingFiber === null) {
        throw new Error(
          'Context can only be read while React is rendering. ' +
            'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
            'In function components, you can read it directly in the function body, but not ' +
            'inside Hooks like useReducer() or useMemo().',
        );
      }

      // 这是该组件的第一个依赖项。创建一个新列表。
      // This is the first dependency for this component. Create a new list.
      lastContextDependency = contextItem;

      // 放在wip fiber的dependencies属性上
      currentlyRenderingFiber.dependencies = {
        lanes: NoLanes, // 默认0
        firstContext: contextItem, // 第一个上下文 - 记着一直【指向上下文链表的第一个上下文对象】
      };


      if (enableLazyContextPropagation) {
        currentlyRenderingFiber.flags |= NeedsPropagation;
      }
    } else {
      
      // Append a new context item.
      lastContextDependency = lastContextDependency.next = contextItem; // 形成【单向链表】
    
    
    }
  }

  // 返回上面的value值
  return value;
}
