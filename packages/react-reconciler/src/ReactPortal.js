/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {REACT_PORTAL_TYPE} from 'shared/ReactSymbols';
import {checkKeyStringCoercion} from 'shared/CheckStringCoercion';

import type {ReactNodeList, ReactPortal} from 'shared/ReactTypes';

// createPortal // +++
export function createPortal(
  children: ReactNodeList,
  containerInfo: any,
  // TODO: figure out the API for cross-renderer implementation.
  implementation: any,
  key: ?string = null,
): ReactPortal {
  if (__DEV__) {
    checkKeyStringCoercion(key);
  }

  // 返回了一个这个对象 // +++
  return {
    // This tag allow us to uniquely identify this as a React Portal
    $$typeof: REACT_PORTAL_TYPE,
    key: key == null ? null : '' + key,
    children,
    containerInfo,
    implementation,
  };
}

/* 
render() {
  // React does *not* create a new div. It renders the children into `domNode`.
  // `domNode` is any valid DOM node, regardless of its location in the DOM.
  return ReactDOM.createPortal(
    this.props.children,
    domNode
  );
}
*/
