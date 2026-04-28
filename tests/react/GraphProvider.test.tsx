import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { GraphProvider, useGraphContext } from '../../src/react/GraphProvider.js';
import type { DataAdapter, DataAdapterConfig } from '../../src/data/DataAdapter.js';
import type { GraphData, NodeData, PaginatedResult, ContentData, DataFilter, PaginationOptions, NodeId } from '../../src/types.js';

function createMockAdapter(initialData: GraphData): DataAdapter {
  return {
    getInitialView: vi.fn(async (_config?: DataAdapterConfig) => initialData),
    getNode: vi.fn(async (id: NodeId) => initialData.nodes.find(n => n.id === id)),
    getNeighbors: vi.fn(async (_nodeId: NodeId, _depth?: number) => ({ nodes: [], edges: [] })),
    findPath: vi.fn(async (_fromId: NodeId, _toId: NodeId) => ({ nodes: [], edges: [] })),
    search: vi.fn(async (_query: string, _pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>> =>
      ({ items: [], total: 0, hasMore: false })),
    filter: vi.fn(async (_filter: DataFilter, _pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>> =>
      ({ items: [], total: 0, hasMore: false })),
    getContent: vi.fn(async (_nodeId: NodeId): Promise<ContentData | undefined> => undefined),
  };
}

/** Helper component to read context values */
function ContextReader({ onContext }: { onContext: (ctx: ReturnType<typeof useGraphContext>) => void }) {
  const ctx = useGraphContext();
  onContext(ctx);
  return null;
}

describe('GraphProvider', () => {
  it('should render children without any data props', () => {
    const { getByText } = render(
      <GraphProvider>
        <div>Hello</div>
      </GraphProvider>,
    );
    expect(getByText('Hello')).toBeTruthy();
  });

  it('should provide store, queryEngine, and aiEngine via context', () => {
    let captured: ReturnType<typeof useGraphContext> | null = null;
    render(
      <GraphProvider>
        <ContextReader onContext={(ctx) => { captured = ctx; }} />
      </GraphProvider>,
    );
    expect(captured).not.toBeNull();
    expect(captured!.store).toBeDefined();
    expect(captured!.queryEngine).toBeDefined();
    expect(captured!.aiEngine).toBeDefined();
  });

  it('should have null dataManager when no data or adapter is provided', () => {
    let captured: ReturnType<typeof useGraphContext> | null = null;
    render(
      <GraphProvider>
        <ContextReader onContext={(ctx) => { captured = ctx; }} />
      </GraphProvider>,
    );
    expect(captured!.dataManager).toBeNull();
  });

  it('should wrap data prop in StaticDataAdapter and create dataManager', async () => {
    const data: GraphData = {
      nodes: [
        { id: '1', attributes: { name: 'A', type: 'test' } },
      ],
      edges: [],
    };

    let captured: ReturnType<typeof useGraphContext> | null = null;

    await act(async () => {
      render(
        <GraphProvider data={data}>
          <ContextReader onContext={(ctx) => { captured = ctx; }} />
        </GraphProvider>,
      );
    });

    expect(captured!.dataManager).not.toBeNull();
    expect(captured!.store.nodeCount).toBe(1);
    expect(captured!.store.getNode('1')?.attributes.name).toBe('A');
  });

  it('should use adapter prop directly when provided', async () => {
    const testData: GraphData = {
      nodes: [
        { id: 'x1', attributes: { name: 'X', type: 'test' } },
      ],
      edges: [],
    };
    const mockAdapter = createMockAdapter(testData);

    let captured: ReturnType<typeof useGraphContext> | null = null;

    await act(async () => {
      render(
        <GraphProvider adapter={mockAdapter}>
          <ContextReader onContext={(ctx) => { captured = ctx; }} />
        </GraphProvider>,
      );
    });

    expect(captured!.dataManager).not.toBeNull();
    expect(mockAdapter.getInitialView).toHaveBeenCalled();
    expect(captured!.store.nodeCount).toBe(1);
  });

  it('should call onReady callback after initialization', async () => {
    const data: GraphData = {
      nodes: [{ id: '1', attributes: { name: 'A', type: 'test' } }],
      edges: [],
    };
    const onReady = vi.fn();

    await act(async () => {
      render(
        <GraphProvider data={data} onReady={onReady}>
          <div>child</div>
        </GraphProvider>,
      );
    });

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('should pass initialViewConfig to adapter', async () => {
    const testData: GraphData = { nodes: [], edges: [] };
    const mockAdapter = createMockAdapter(testData);
    const config = { rootNodeId: 'abc' };

    await act(async () => {
      render(
        <GraphProvider adapter={mockAdapter} initialViewConfig={config}>
          <div>child</div>
        </GraphProvider>,
      );
    });

    expect(mockAdapter.getInitialView).toHaveBeenCalledWith(config);
  });

  it('should provide dataManager through context for children to access', async () => {
    const data: GraphData = {
      nodes: [{ id: '1', attributes: { name: 'A', type: 'test' } }],
      edges: [],
    };

    let dataManagerRef: unknown = 'not-set';

    function DataManagerReader() {
      const { dataManager } = useGraphContext();
      dataManagerRef = dataManager;
      return null;
    }

    await act(async () => {
      render(
        <GraphProvider data={data}>
          <DataManagerReader />
        </GraphProvider>,
      );
    });

    expect(dataManagerRef).not.toBeNull();
    expect(dataManagerRef).not.toBe('not-set');
  });

  it('returns a stable context value across re-renders when data is unchanged', () => {
    // Regression: prior to 0.1.7 the context value object was rebuilt on every
    // render of `GraphProvider`. Combined with a fresh `StaticDataAdapter`
    // also recreated on every render, downstream consumer effects (e.g.
    // `InferaGraphInner`'s controller-mount effect) could re-fire on every
    // parent render and — on graphs with bidirectional edges (`father_of`
    // ↔ `son_of`) — produce a runaway render loop that exhausted the call
    // stack with `RangeError: Maximum call stack size exceeded`.
    const data: GraphData = {
      nodes: [
        { id: 'abraham', attributes: { name: 'Abraham', type: 'person' } },
        { id: 'isaac', attributes: { name: 'Isaac', type: 'person' } },
      ],
      edges: [
        { id: 'e1', sourceId: 'abraham', targetId: 'isaac', attributes: { type: 'father_of' } },
        { id: 'e2', sourceId: 'isaac', targetId: 'abraham', attributes: { type: 'son_of' } },
      ],
    };
    const seen: Array<ReturnType<typeof useGraphContext>> = [];
    const { rerender } = render(
      <GraphProvider data={data}>
        <ContextReader onContext={(ctx) => { seen.push(ctx); }} />
      </GraphProvider>,
    );
    rerender(
      <GraphProvider data={data}>
        <ContextReader onContext={(ctx) => { seen.push(ctx); }} />
      </GraphProvider>,
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    // Same `data` reference + same isReady → context value should be
    // referentially stable so consumer effects don't re-fire.
    expect(seen[0]).toBe(seen[seen.length - 1]);
  });

  it('should throw when useGraphContext is used outside of GraphProvider', () => {
    function BadComponent() {
      useGraphContext();
      return null;
    }

    // Suppress React error boundary console errors
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<BadComponent />)).toThrow('useGraphContext must be used within a GraphProvider');
    spy.mockRestore();
  });
});
