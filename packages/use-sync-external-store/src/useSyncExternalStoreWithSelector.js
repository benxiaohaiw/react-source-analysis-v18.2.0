/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import * as React from 'react';
import is from 'shared/objectIs';
import {useSyncExternalStore} from 'use-sync-external-store/src/useSyncExternalStore';

// Intentionally not using named imports because Rollup uses dynamic dispatch
// for CommonJS interop.
const {useRef, useEffect, useMemo, useDebugValue} = React;

// 和useSyncExternalStore是相同的，但是支持selector和isEqual参数 // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// Same as useSyncExternalStore, but supports selector and isEqual arguments.
export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (() => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: void | null | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {

  // 使用这个来去收集这个已渲染的快照 // ++++++++++++++++++++++++++++++++++++++++++++++++++
  // Use this to track the rendered snapshot.
  const instRef = useRef(null); // 搞个ref
  let inst;
  if (instRef.current === null) {
    inst = { // 没有值则创建一个实例
      hasValue: false,
      value: (null: Selection | null),
    };
    instRef.current = inst; // 存储在ref的current身上
  } else {
    inst = instRef.current; // 有的话那么实例还是current身上的 // ++++++++++++++++++++++++
  }

  /// useMemo函数：依赖数组为[getSnapshot, getServerSnapshot, selector, isEqual]，只会计算一次，如果这其中一个变化了那么需要重新的计算这两个函数的 // +++
  const [getSelection, getServerSelection] = useMemo(() => {
    // Track the memoized state using closure variables that are local to this
    // memoized instance of a getSnapshot function. Intentionally not using a
    // useRef hook, because that state would be shared across all concurrent
    // copies of the hook/component.
    let hasMemo = false;
    let memoizedSnapshot;
    let memoizedSelection: Selection;
    
    // 选择器
    const memoizedSelector = nextSnapshot => {
      if (!hasMemo) {
        // 第一次调用钩子时，没有记忆结果。
        // The first time the hook is called, there is no memoized result.
        hasMemo = true; // 标记有memo
        memoizedSnapshot = nextSnapshot; // 存储此时新的快照

        const nextSelection = selector(nextSnapshot); // 执行selector函数得出新的挑选的数据
        
        // 有isEqual函数
        if (isEqual !== undefined) {
          // Even if the selector has changed, the currently rendered selection
          // may be equal to the new selection. We should attempt to reuse the
          // current value if possible, to preserve downstream memoizations.
          if (inst.hasValue) {
            const currentSelection = inst.value;
            if (isEqual(currentSelection, nextSelection)) { // 使用这个参数函数进行比较之前选择的值和现在选择的值是否一样的
              memoizedSelection = currentSelection; // 一样的那么存储inst.value之前的值
              return currentSelection; // 返回inst.value之前的值
            }
          }
        }
        // 存储挑选的值
        memoizedSelection = nextSelection;

        return nextSelection; // 返回挑选的值
      }

      // We may be able to reuse the previous invocation's result.
      const prevSnapshot: Snapshot = (memoizedSnapshot: any); // 上一次的快照
      const prevSelection: Selection = (memoizedSelection: any); // 上一次选择的值

      // Object.is算法比较
      if (is(prevSnapshot, nextSnapshot)) {
        // 快照与上次相同。重复使用之前的选择。
        // The snapshot is the same as last time. Reuse the previous selection.
        return prevSelection; // 返回之前的值
      }

      // 快照已经改变，所以我们需要计算一个新的选择。
      // The snapshot has changed, so we need to compute a new selection.
      const nextSelection = selector(nextSnapshot); // 重新计算选择的值

      // If a custom isEqual function is provided, use that to check if the data
      // has changed. If it hasn't, return the previous selection. That signals
      // to React that the selections are conceptually equal, and we can bail
      // out of rendering.
      if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) { // 还是isEqual函数
        // 一样则直接返回之前的值
        return prevSelection;
      }

      // 存储新的快照
      memoizedSnapshot = nextSnapshot;
      // 存储新的选择的值
      memoizedSelection = nextSelection;

      return nextSelection; // 返回新的选择的值
    };

    // Assigning this to a constant so that Flow knows it can't change.
    const maybeGetServerSnapshot =
      getServerSnapshot === undefined ? null : getServerSnapshot; // 格式参数
    
    // 懒获取数据

    const getSnapshotWithSelector = () => memoizedSelector(getSnapshot()); // 准备getSnapshotWithSelector函数
    
    // 准备getServerSnapshotWithSelector函数
    const getServerSnapshotWithSelector =
      maybeGetServerSnapshot === null
        ? undefined
        : () => memoizedSelector(maybeGetServerSnapshot());
    

    return [getSnapshotWithSelector, getServerSnapshotWithSelector]; // 返回一个数组

  }, [getSnapshot, getServerSnapshot, selector, isEqual]); // +++


  // 得到value值
  const value = useSyncExternalStore(
    subscribe, // 订阅函数
    getSelection, // getSelection函数
    getServerSelection,
  );

  // 一个useEffect：它依赖为[value]，value变化了需要重新存储
  useEffect(() => {
    inst.hasValue = true; // 实例标记有值
    inst.value = value; // 存储value
  }, [value]);

  useDebugValue(value);

  // 返回这个value // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  return value;
}
