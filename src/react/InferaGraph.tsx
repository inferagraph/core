import React, { useRef, useEffect, useMemo } from 'react';
import type {
  GraphData,
  LayoutMode,
  NodeRenderConfig,
  NodeComponentProps,
  TooltipConfig,
  TooltipComponentProps,
} from '../types.js';
import { GraphProvider, useGraphContext } from './GraphProvider.js';
import { createReactNodeRenderFn, createReactTooltipRenderFn } from './ReactNodeRenderer.js';
import { SceneController } from '../renderer/SceneController.js';

export interface InferaGraphProps {
  data?: GraphData;
  layout?: LayoutMode;
  nodeRender?: NodeRenderConfig;
  tooltip?: TooltipConfig;
  className?: string;
  style?: React.CSSProperties;
}

interface InferaGraphInnerProps {
  layout?: LayoutMode;
  nodeRender?: NodeRenderConfig;
  tooltip?: TooltipConfig;
  className?: string;
  style?: React.CSSProperties;
}

function InferaGraphInner({
  layout,
  nodeRender,
  tooltip,
  className,
  style,
}: InferaGraphInnerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const { store, isReady } = useGraphContext();

  const resolvedNodeRender = useMemo(() => {
    if (!nodeRender) return undefined;
    if (nodeRender.renderNode) return nodeRender; // renderNode takes priority
    if (nodeRender.component) {
      return {
        ...nodeRender,
        renderNode: createReactNodeRenderFn(nodeRender.component as React.ComponentType<NodeComponentProps>),
      };
    }
    return nodeRender;
  }, [nodeRender]);

  const resolvedTooltip = useMemo(() => {
    if (!tooltip) return undefined;
    if (tooltip.renderTooltip) return tooltip; // renderTooltip takes priority
    if (tooltip.component) {
      return {
        ...tooltip,
        renderTooltip: createReactTooltipRenderFn(tooltip.component as React.ComponentType<TooltipComponentProps>),
      };
    }
    return tooltip;
  }, [tooltip]);

  // Mount the scene controller once on first render. The controller
  // owns the WebGLRenderer, layout engine, camera controls, and meshes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const controller = new SceneController({
      store,
      layout: layout ?? 'graph',
      nodeRender: resolvedNodeRender,
      tooltip: resolvedTooltip,
    });
    controller.attach(container);
    controllerRef.current = controller;

    // Keep the canvas in sync with container size.
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => controller.resize());
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver?.disconnect();
      controller.detach();
      controllerRef.current = null;
    };
    // The controller mounts exactly once per `store` instance. Layout /
    // nodeRender / tooltip changes are pushed in via the effects below so
    // prop changes don't tear down and rebuild the renderer.
  }, [store]);

  // When the store finishes loading initial data, build the meshes.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || !isReady) return;
    controller.syncFromStore();
  }, [isReady]);

  // Push layout-mode changes into the controller without remounting.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setLayout(layout ?? 'graph');
  }, [layout]);

  // Push node-render / tooltip changes.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setNodeRender(resolvedNodeRender);
  }, [resolvedNodeRender]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setTooltip(resolvedTooltip);
  }, [resolvedTooltip]);

  return (
    <div
      ref={containerRef}
      className={`ig-container ${className ?? ''}`}
      style={{ width: '100%', height: '100%', position: 'relative', ...style }}
    />
  );
}

export function InferaGraph(props: InferaGraphProps): React.JSX.Element {
  const { data, layout, nodeRender, tooltip, className, style } = props;
  return (
    <GraphProvider data={data}>
      <InferaGraphInner
        layout={layout}
        nodeRender={nodeRender}
        tooltip={tooltip}
        className={className}
        style={style}
      />
    </GraphProvider>
  );
}
