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
import type { NodeColorFn } from '../renderer/NodeColorResolver.js';
import type { EdgeColorFn } from '../renderer/EdgeColorMap.js';
import type { EdgeLabelMap } from '../utils/aggregateEdges.js';

export interface InferaGraphProps {
  data?: GraphData;
  layout?: LayoutMode;
  nodeRender?: NodeRenderConfig;
  tooltip?: TooltipConfig;
  /** Pool of colors for deterministic auto-assignment. */
  palette?: readonly string[];
  /** Explicit type → color map for nodes. */
  nodeColors?: Record<string, string>;
  /** Function override for nodes. */
  nodeColorFn?: NodeColorFn;
  /** Explicit relationship-type → color map for edges. */
  edgeColors?: Record<string, string>;
  /** Function override for edges. */
  edgeColorFn?: EdgeColorFn;
  /**
   * Incoming-edge label map for the default tooltip's natural-language
   * description (e.g. `{ father_of: 'Son of', mother_of: 'Son of' }`).
   * Ignored when `tooltip.renderTooltip` / `tooltip.component` is supplied.
   */
  incomingEdgeLabels?: EdgeLabelMap;
  /**
   * Outgoing-edge label map for the default tooltip's natural-language
   * description (e.g. `{ father_of: 'Father of' }`).
   */
  outgoingEdgeLabels?: EdgeLabelMap;
  className?: string;
  style?: React.CSSProperties;
}

interface InferaGraphInnerProps {
  layout?: LayoutMode;
  nodeRender?: NodeRenderConfig;
  tooltip?: TooltipConfig;
  palette?: readonly string[];
  nodeColors?: Record<string, string>;
  nodeColorFn?: NodeColorFn;
  edgeColors?: Record<string, string>;
  edgeColorFn?: EdgeColorFn;
  incomingEdgeLabels?: EdgeLabelMap;
  outgoingEdgeLabels?: EdgeLabelMap;
  className?: string;
  style?: React.CSSProperties;
}

function InferaGraphInner({
  layout,
  nodeRender,
  tooltip,
  palette,
  nodeColors,
  nodeColorFn,
  edgeColors,
  edgeColorFn,
  incomingEdgeLabels,
  outgoingEdgeLabels,
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

  // Mount the scene controller once on first render. The controller owns the
  // WebGL renderer, layout engine, camera controls, and meshes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const controller = new SceneController({
      store,
      layout: layout ?? 'graph',
      nodeRender: resolvedNodeRender,
      tooltip: resolvedTooltip,
      palette,
      nodeColors,
      nodeColorFn,
      edgeColors,
      edgeColorFn,
      incomingEdgeLabels,
      outgoingEdgeLabels,
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
    // The controller mounts exactly once per store. Layout / nodeRender /
    // tooltip changes are pushed in via the effects below so prop changes
    // don't tear down and rebuild the renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Push edge-label map changes so consumers can swap relationship phrasing
  // without a full remount. The defaults still apply when undefined.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setIncomingEdgeLabels(incomingEdgeLabels);
  }, [incomingEdgeLabels]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setOutgoingEdgeLabels(outgoingEdgeLabels);
  }, [outgoingEdgeLabels]);

  return (
    <div
      ref={containerRef}
      className={`ig-container ${className ?? ''}`}
      style={{ width: '100%', height: '100%', position: 'relative', ...style }}
    />
  );
}

export function InferaGraph(props: InferaGraphProps): React.JSX.Element {
  const {
    data,
    layout,
    nodeRender,
    tooltip,
    palette,
    nodeColors,
    nodeColorFn,
    edgeColors,
    edgeColorFn,
    incomingEdgeLabels,
    outgoingEdgeLabels,
    className,
    style,
  } = props;
  return (
    <GraphProvider data={data}>
      <InferaGraphInner
        layout={layout}
        nodeRender={nodeRender}
        tooltip={tooltip}
        palette={palette}
        nodeColors={nodeColors}
        nodeColorFn={nodeColorFn}
        edgeColors={edgeColors}
        edgeColorFn={edgeColorFn}
        incomingEdgeLabels={incomingEdgeLabels}
        outgoingEdgeLabels={outgoingEdgeLabels}
        className={className}
        style={style}
      />
    </GraphProvider>
  );
}
