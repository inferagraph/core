import React, { useRef, useEffect } from 'react';
import type { GraphData, LayoutMode } from '../types.js';
import { GraphProvider } from './GraphProvider.js';

export interface InferaGraphProps {
  data?: GraphData;
  layout?: LayoutMode;
  className?: string;
  style?: React.CSSProperties;
}

function InferaGraphInner({ data, layout, className, style }: InferaGraphProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

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
