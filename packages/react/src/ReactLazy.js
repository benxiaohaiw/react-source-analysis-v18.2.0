/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Wakeable, Thenable} from 'shared/ReactTypes';

import {REACT_LAZY_TYPE} from 'shared/ReactSymbols';

const Uninitialized = -1;
const Pending = 0;
const Resolved = 1;
const Rejected = 2;

type UninitializedPayload<T> = {
  _status: -1,
  _result: () => Thenable<{default: T, ...}>,
};

type PendingPayload = {
  _status: 0,
  _result: Wakeable,
};

type ResolvedPayload<T> = {
  _status: 1,
  _result: {default: T, ...},
};

type RejectedPayload = {
  _status: 2,
  _result: mixed,
};

type Payload<T> =
  | UninitializedPayload<T>
  | PendingPayload
  | ResolvedPayload<T>
  | RejectedPayload;

export type LazyComponent<T, P> = {
  $$typeof: symbol | number,
  _payload: P,
  _init: (payload: P) => T,
};

// 懒初始化器函数 // +++
function lazyInitializer<T>(payload: Payload<T>): T {

  // 是未初始化的
  if (payload._status === Uninitialized) {
    const ctor = payload._result;


    const thenable = ctor(); // 执行这个函数 /// +++ // 正常应该返回一个promise // +++
    // Transition to the next state.
    // This might throw either because it's missing or throws. If so, we treat it
    // as still uninitialized and try again next time. Which is the same as what
    // happens if the ctor or any wrappers processing the ctor throws. This might
    // end up fixing it if the resolution was a concurrency bug.
    thenable.then( // 给这个promise注册成功和失败的回调 // +++
      moduleObject => {
        if (payload._status === Pending || payload._status === Uninitialized) {
          // Transition to the next state.
          const resolved: ResolvedPayload<T> = (payload: any);
          resolved._status = Resolved; // 状态更改为已解析
          resolved._result = moduleObject; // 结果变为模块对象 // +++
          // { default: fn }
        }
      },
      error => {
        if (payload._status === Pending || payload._status === Uninitialized) {
          // Transition to the next state.
          const rejected: RejectedPayload = (payload: any);
          rejected._status = Rejected;
          rejected._result = error;
        }
      },
    );

    // 未初始化的
    if (payload._status === Uninitialized) {
      // In case, we're still uninitialized, then we're waiting for the thenable
      // to resolve. Set it as pending in the meantime.
      const pending: PendingPayload = (payload: any);
      pending._status = Pending; // 更改为待处理的 // +++
      pending._result = thenable; // 结果变为上面的promise // +++
    }
  }

  /// 当前状态是已解析
  if (payload._status === Resolved) { // +++
    const moduleObject = payload._result; // { default: fn }
    if (__DEV__) {
      if (moduleObject === undefined) {
        console.error(
          'lazy: Expected the result of a dynamic imp' +
            'ort() call. ' +
            'Instead received: %s\n\nYour code should look like: \n  ' +
            // Break up imports to avoid accidentally parsing them as dependencies.
            'const MyComponent = lazy(() => imp' +
            "ort('./MyComponent'))\n\n" +
            'Did you accidentally put curly braces around the import?',
          moduleObject,
        );
      }
    }
    if (__DEV__) {
      if (!('default' in moduleObject)) {
        console.error(
          'lazy: Expected the result of a dynamic imp' +
            'ort() call. ' +
            'Instead received: %s\n\nYour code should look like: \n  ' +
            // Break up imports to avoid accidentally parsing them as dependencies.
            'const MyComponent = lazy(() => imp' +
            "ort('./MyComponent'))",
          moduleObject,
        );
      }
    }

    // +++
    return moduleObject.default; // 返回这个default属性 - 就是一个fn
  } else {

    // 其它状态那么将抛出这个结果 - promise对象 // +++
    throw payload._result;
  }
}


/// lazy函数 // +++
export function lazy<T>(
  ctor: () => Thenable<{default: T, ...}>,
): LazyComponent<T, Payload<T>> {

  // 准备payload对象 // +++
  const payload: Payload<T> = {
    // We use these fields to store the result.
    _status: Uninitialized, // 未初始化
    _result: ctor, // 函数
  };

  // +++
  const lazyType: LazyComponent<T, Payload<T>> = {
    $$typeof: REACT_LAZY_TYPE, // +++
    _payload: payload, /// payload对象
    _init: lazyInitializer, // 懒初始化器函数 // +++
  };

  if (__DEV__) {
    // In production, this would just set it on the object.
    let defaultProps;
    let propTypes;
    // $FlowFixMe
    Object.defineProperties(lazyType, {
      defaultProps: {
        configurable: true,
        get() {
          return defaultProps;
        },
        set(newDefaultProps) {
          console.error(
            'React.lazy(...): It is not supported to assign `defaultProps` to ' +
              'a lazy component import. Either specify them where the component ' +
              'is defined, or create a wrapping component around it.',
          );
          defaultProps = newDefaultProps;
          // Match production behavior more closely:
          // $FlowFixMe
          Object.defineProperty(lazyType, 'defaultProps', {
            enumerable: true,
          });
        },
      },
      propTypes: {
        configurable: true,
        get() {
          return propTypes;
        },
        set(newPropTypes) {
          console.error(
            'React.lazy(...): It is not supported to assign `propTypes` to ' +
              'a lazy component import. Either specify them where the component ' +
              'is defined, or create a wrapping component around it.',
          );
          propTypes = newPropTypes;
          // Match production behavior more closely:
          // $FlowFixMe
          Object.defineProperty(lazyType, 'propTypes', {
            enumerable: true,
          });
        },
      },
    });
  }

  // +++ // 返回这个对象 // +++
  return lazyType;
}

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

// 说明： // ++++++
// +++
// 要注意A和B都是已经经过lazy函数执行后生成的类型对象了 - 所以当这两个组件都被加载完毕之后再进行状态改变切换时，虽然vnode是重新生成但是它们的type一直都是这两个对象
// 没有变化过，所以说之后再经过Lazy类型的时候就直接返回组件函数了 - 而不是报错和其它的逻辑了 // 要注意！！！
// +++

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
