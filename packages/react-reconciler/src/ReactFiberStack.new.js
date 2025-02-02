/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';

export type StackCursor<T> = {current: T};

const valueStack: Array<any> = [];

let fiberStack: Array<Fiber | null>;

if (__DEV__) {
  fiberStack = [];
}

let index = -1;

// 创建游标 // +++
function createCursor<T>(defaultValue: T): StackCursor<T> {
  
  // 准备游标对象
  return {
    current: defaultValue, // +++
  };

}

function isEmpty(): boolean {
  return index === -1;
}

// 弹出 // +++
function pop<T>(cursor: StackCursor<T>, fiber: Fiber): void {
  if (index < 0) {
    if (__DEV__) {
      console.error('Unexpected pop.');
    }
    return;
  }

  if (__DEV__) {
    if (fiber !== fiberStack[index]) {
      console.error('Unexpected Fiber popped.');
    }
  }

  // 把之前的值存入cursor.current
  cursor.current = valueStack[index];

  // 置为null
  valueStack[index] = null;

  if (__DEV__) {
    fiberStack[index] = null;
  }

  index--;
}

// push方法 // +++
function push<T>(cursor: StackCursor<T>, value: T, fiber: Fiber): void {
  index++;

  // 值栈 - 存之前的值 // +++
  valueStack[index] = cursor.current; // +++

  if (__DEV__) {
    fiberStack[index] = fiber;
  }

  // 存入新的value值 // +++
  cursor.current = value; // +++
}

function checkThatStackIsEmpty() {
  if (__DEV__) {
    if (index !== -1) {
      console.error(
        'Expected an empty stack. Something was not reset properly.',
      );
    }
  }
}

function resetStackAfterFatalErrorInDev() {
  if (__DEV__) {
    index = -1;
    valueStack.length = 0;
    fiberStack.length = 0;
  }
}

export {
  createCursor,
  isEmpty,
  pop,
  push,
  // DEV only:
  checkThatStackIsEmpty,
  resetStackAfterFatalErrorInDev,
};
