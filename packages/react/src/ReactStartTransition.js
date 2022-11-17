/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
import type {StartTransitionOptions} from 'shared/ReactTypes';

import ReactCurrentBatchConfig from './ReactCurrentBatchConfig';
import {enableTransitionTracing} from 'shared/ReactFeatureFlags';

// startTransition api
export function startTransition(
  scope: () => void,
  options?: StartTransitionOptions,
) {
  const prevTransition = ReactCurrentBatchConfig.transition;
  
  
  ReactCurrentBatchConfig.transition = {}; // 将其设置为空对象 // +++
  // 将直接导致packages/react-reconciler/src/ReactFiberWorkLoop.new.js下的requestUpdateLane函数的执行结果返回TransitionLane1同时nextTransitionLane将进行左移变为TransitionLane2了
  // 那么返回的lane的值则是64
  // 这个优先级将会开启【并发渲染】 // +++


  const currentTransition = ReactCurrentBatchConfig.transition;

  if (__DEV__) {
    ReactCurrentBatchConfig.transition._updatedFibers = new Set();
  }

  if (enableTransitionTracing) {
    if (options !== undefined && options.name !== undefined) {
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      ReactCurrentBatchConfig.transition.name = options.name;
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      ReactCurrentBatchConfig.transition.startTime = -1;
    }
  }

  try {

    // +++
    scope(); // 直接执行传入的参数函数 // +++

  } finally {

    // +++
    ReactCurrentBatchConfig.transition = prevTransition; // 恢复之前的值 // +++

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
    // setTab(tab => tab === 'A' ? 'B' : 'A')
    // 显示加载中...组件之后B组件准备好以后再显示
    
    startTransition(() => {
      setTab(tab => tab === 'A' ? 'B' : 'A')
    }) // 暂停A组件显示 - B组件准备好以后再显示
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


createRoot(document.getElementById('root'))
  .render(<App/>)

*/
