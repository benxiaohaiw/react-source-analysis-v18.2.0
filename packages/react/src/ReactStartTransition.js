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

/* 
当前的这个startTransition api以及packages/react-reconciler/src/ReactFiberHooks.new.js下的useTransition hook返回的startTransition函数，它们的逻辑都是相同的
那么它会导致packages/react-reconciler/src/ReactFiberWorkLoop.new.js下的requestUpdateLane函数返回【过渡车道n】
所属过渡车道集合的车道将会直接影响【渲染阶段】采用【并发渲染】，也就是【开启时间切片】

dispatchSetState
  requestUpdateLane -> 正是执行startTransition函数的原因导致该函数会返回【过渡车道n（n为1-16）】，也就是TransitionLane1，同时nextTransitionLane左移变为TransitionLane2
  scheduleUpdateOnFiber -> markRootUpdated（+++ - pendingLanes） -> ensureRootIsScheduled -> getNextLanes -> getHighestPriorityLane -> 【确认是调度微任务还是宏任务】 // ++++++
    scheduleMicrotask -> flushSyncCallbacks -> performSyncWorkOnRoot
    scheduleCallback -> performConcurrentWorkOnRoot
      performSyncWorkOnRoot -> getNextLanes -> renderRootSync -> commitRoot
      performConcurrentWorkOnRoot -> getNextLanes -> shouldTimeSlice ? renderRootConcurrent : renderRootSync -> finishConcurrentRender
          let lanes = getNextLanes(
            root,
            root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes,
          );
  entangleTransitionUpdate // +++

此外在dispatchSetState中的entangleTransitionUpdate函数会去检查【当前请求到的更新lane】是否属于过渡车道
若属于则执行markRootEntangled函数，若不属于则什么事情都不做

root.entangledLanes总共出现的位置如下：

1. getNextLanes // +++
  packages/react-reconciler/src/ReactFiberLane.new.js

2. markRootFinished(root, remainingLanes)
  packages/react-reconciler/src/ReactFiberLane.new.js
  root.entangledLanes &= remainingLanes;

3. markRootEntangled
  packages/react-reconciler/src/ReactFiberLane.new.js
  主要是|或运算root.entangledLanes变量和root.entanglements数组

- markRootEntangled函数中进行的root.entangledLanes使用的地方是在getNextLanes、markRootFinished、markRootEntangled


// +++
总结：
startTransition api影响的地方主要还是getNextLanes函数获取的车道集合

纠缠：|或运算

entangleTransitionUpdate: 纠缠过渡更新
  markRootEntangled
以及
getNextLanes
// ++++++
实际上就是为了在getNextLanes中可以【检查纠缠的车道并将它们添加到批次中】。纠缠在一起之后，因此它们在同一批中渲染（这是重点）。 // +++
// 提取信息来自packages/react-reconciler/src/ReactFiberLane.new.js中的getNextLanes方法中的注释
// ++++++
// +++

// +++
随后可以开启时间切片 - 并发渲染 // +++


举例：
在react中的点击事件中
  setXxx
    startTransition
      setYyy

---


*/

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
