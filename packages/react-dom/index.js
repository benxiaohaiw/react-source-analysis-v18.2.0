/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// Export all exports so that they're available in tests.
// We can't use export * from in Flow for some reason.
export {default as __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED} from './src/ReactDOMSharedInternals';
export {
  createPortal, // createPortal api // +++
  // 入口
  createRoot, // 创建FiberRootNode和FiberNode // createRoot(dom).render(element)
  hydrateRoot,
  findDOMNode,
  flushSync,
  hydrate,
  render,
  unmountComponentAtNode,
  unstable_batchedUpdates, // 批量更新，原理也就是把executionContext更改为BatchedContext然后进而执行参数fn函数
  unstable_createEventHandle,
  unstable_flushControlled,
  unstable_isNewReconciler,
  unstable_renderSubtreeIntoContainer,
  unstable_runWithPriority, // DO NOT USE: Temporarily exposed to migrate off of Scheduler.runWithPriority.
  preinit,
  preload,
  version,
} from './src/client/ReactDOM';
