import React, { useRef, useEffect, useMemo } from 'react';
import type { GraphData, LayoutMode, NodeRenderConfig, NodeComponentProps, TooltipConfig, TooltipComponentProps } from '../types.js';
import { GraphProvider } from './GraphProvider.js';
import { createReactNodeRenderFn, createReactTooltipRenderFn } from './ReactNodeRenderer.js';

export interface InferaGraphProps {
  data?: GraphData;
  layout?: LayoutMode;
  nodeRender?: NodeRenderConfig;
  tooltip?: TooltipConfig;
  className?: string;
  style?: React.CSSProperties;
}

function InferaGraphInner({ data: _data, layout: _layout, nodeRender, tooltip, className, style }: InferaGraphProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

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

  const resolvedNodeRenderRef = useRef(resolvedNodeRender);
  resolvedNodeRenderRef.current = resolvedNodeRender;

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

  const resolvedTooltipRef = useRef(resolvedTooltip);
  resolvedTooltipRef.current = resolvedTooltip;

  useEffect(() => {
    // Initialize WebGL renderer and scene when container mounts
    const container = containerRef.current;
    if (!container) return;

    return () => {
      // Cleanup renderer
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`ig-container ${className ?? ''}`}
      style={{ width: '100%', height: '100%', position: 'relative', ...style }}
    />
  );
}

export function InferaGraph(props: InferaGraphProps): React.JSX.Element {
  return (
    <GraphProvider>
      <InferaGraphInner {...props} />
    </GraphProvider>
  );
}
