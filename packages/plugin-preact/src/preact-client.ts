// Named re-exports only — `export *` from compat + hooks + preact collides
// (h, useState, Fragment, …) and Vite's native ESM module then fails to load.
export {
  h,
  render,
  hydrate,
  Component,
  Fragment,
  createContext,
  createRef,
  toChildArray,
  cloneElement,
  createElement,
  isValidElement,
} from 'preact';
export {
  useState,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useMemo,
  useCallback,
  useContext,
  useId,
  useErrorBoundary,
  useDebugValue,
  useImperativeHandle,
} from 'preact/hooks';
export { jsx, jsxs } from 'preact/jsx-runtime';
export {
  memo,
  forwardRef,
  Children,
  createPortal,
  lazy,
  Suspense,
  PureComponent,
} from 'preact/compat';
