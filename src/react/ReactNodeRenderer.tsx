import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type { NodeData, NodeRenderFn, NodeRenderState, NodeComponentProps, TooltipRenderFn, TooltipData, TooltipComponentProps } from '../types.js';

/**
 * Creates a NodeRenderFn from a React component.
 * Each node gets its own React root (createRoot).
 * Returns a cleanup function that unmounts the root.
 */
export function createReactNodeRenderFn(
  Component: React.ComponentType<NodeComponentProps>
): NodeRenderFn {
  const roots = new Map<HTMLElement, Root>();

  return (container: HTMLElement, node: NodeData, state: NodeRenderState): (() => void) => {
    let root = roots.get(container);
    if (!root) {
      root = createRoot(container);
      roots.set(container, root);
    }

    root.render(
      createElement(Component, {
        node,
        isSelected: state.isSelected,
        isHighlighted: state.isHighlighted,
      })
    );

    return () => {
      const r = roots.get(container);
      if (r) {
        r.unmount();
        roots.delete(container);
      }
    };
  };
}

/**
 * Creates a TooltipRenderFn from a React component.
 * Each tooltip gets its own React root.
 */
export function createReactTooltipRenderFn(
  Component: React.ComponentType<TooltipComponentProps>
): TooltipRenderFn {
  let root: Root | null = null;
  let currentContainer: HTMLElement | null = null;

  return (container: HTMLElement, data: TooltipData): (() => void) => {
    if (!root || currentContainer !== container) {
      if (root) root.unmount();
      root = createRoot(container);
      currentContainer = container;
    }

    root.render(
      createElement(Component, {
        type: data.type,
        node: data.node,
        edge: data.edge,
      })
    );

    return () => {
      if (root) {
        root.unmount();
        root = null;
        currentContainer = null;
      }
    };
  };
}
