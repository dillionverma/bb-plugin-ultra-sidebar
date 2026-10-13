// dnd-kit's type declarations name the global `JSX` namespace, which React
// 19's types no longer provide. Point it at React's own so they resolve;
// this file is types only and is never bundled.
import type { JSX as ReactJSX } from "react";

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}

export {};
