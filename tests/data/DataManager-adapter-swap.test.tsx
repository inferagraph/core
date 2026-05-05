import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { GraphProvider, useGraphContext } from '../../src/react/GraphProvider.js';
import type {
  DataAdapter,
  DataAdapterConfig,
} from '../../src/data/DataAdapter.js';
import type {
  GraphData,
  NodeData,
  ContentData,
  PaginatedResult,
  PaginationOptions,
  DataFilter,
  NodeId,
} from '../../src/types.js';

function adapterFor(initialData: GraphData): DataAdapter {
  return {
    getInitialView: vi.fn(async (_c?: DataAdapterConfig) => initialData),
    getNode: vi.fn(async (id: NodeId) =>
      initialData.nodes.find((n) => n.id === id),
    ),
    getNeighbors: vi.fn(async (_id: NodeId, _d?: number) => ({
      nodes: [],
      edges: [],
    })),
    findPath: vi.fn(async (_a: NodeId, _b: NodeId) => ({
      nodes: [],
      edges: [],
    })),
    search: vi.fn(
      async (
        _q: string,
        _p?: PaginationOptions,
      ): Promise<PaginatedResult<NodeData>> => ({
        items: [],
        total: 0,
        hasMore: false,
      }),
    ),
    filter: vi.fn(
      async (
        _f: DataFilter,
        _p?: PaginationOptions,
      ): Promise<PaginatedResult<NodeData>> => ({
        items: [],
        total: 0,
        hasMore: false,
      }),
    ),
    getContent: vi.fn(
      async (_id: NodeId): Promise<ContentData | undefined> => undefined,
    ),
  };
}

function ContextReader({
  onContext,
}: {
  onContext: (ctx: ReturnType<typeof useGraphContext>) => void;
}) {
  const ctx = useGraphContext();
  onContext(ctx);
  return null;
}

const dataA: GraphData = {
  nodes: [{ id: 'a1', attributes: { name: 'A1', type: 'test' } }],
  edges: [],
};
const dataB: GraphData = {
  nodes: [
    { id: 'b1', attributes: { name: 'B1', type: 'test' } },
    { id: 'b2', attributes: { name: 'B2', type: 'test' } },
  ],
  edges: [],
};

describe('GraphProvider — adapter-swap behavior (Phase 6)', () => {
  it('exposes the adapter via DataManager.adapter getter', async () => {
    const adapter = adapterFor(dataA);
    let captured: ReturnType<typeof useGraphContext> | null = null;
    await act(async () => {
      render(
        <GraphProvider adapter={adapter}>
          <ContextReader onContext={(ctx) => { captured = ctx; }} />
        </GraphProvider>,
      );
    });
    expect(captured!.dataManager).not.toBeNull();
    expect(captured!.dataManager!.adapter).toBe(adapter);
  });

  it('does NOT swap DataManager when adapter identity is unchanged', async () => {
    const adapter = adapterFor(dataA);
    const seen: Array<ReturnType<typeof useGraphContext>['dataManager']> = [];
    const { rerender } = render(
      <GraphProvider adapter={adapter}>
        <ContextReader
          onContext={(ctx) => {
            seen.push(ctx.dataManager);
          }}
        />
      </GraphProvider>,
    );
    await act(async () => {
      // Resolve any pending init promises.
    });
    rerender(
      <GraphProvider adapter={adapter}>
        <ContextReader
          onContext={(ctx) => {
            seen.push(ctx.dataManager);
          }}
        />
      </GraphProvider>,
    );
    await act(async () => {});
    const non = seen.filter((dm) => dm !== null);
    expect(non.length).toBeGreaterThan(1);
    // Same DataManager identity across renders since adapter is unchanged.
    expect(non[0]).toBe(non[non.length - 1]);
  });

  it('swaps DataManager + clears the store when adapter changes', async () => {
    const adapterA = adapterFor(dataA);
    const adapterB = adapterFor(dataB);
    let captured: ReturnType<typeof useGraphContext> | null = null;
    const { rerender } = render(
      <GraphProvider adapter={adapterA}>
        <ContextReader onContext={(ctx) => { captured = ctx; }} />
      </GraphProvider>,
    );
    await act(async () => {});
    const dmA = captured!.dataManager;
    expect(dmA).not.toBeNull();
    expect(captured!.store.nodeCount).toBe(1);
    expect(captured!.store.hasNode('a1')).toBe(true);

    rerender(
      <GraphProvider adapter={adapterB}>
        <ContextReader onContext={(ctx) => { captured = ctx; }} />
      </GraphProvider>,
    );
    await act(async () => {});

    const dmB = captured!.dataManager;
    expect(dmB).not.toBeNull();
    expect(dmB).not.toBe(dmA);
    expect(dmB!.adapter).toBe(adapterB);
    // Store wiped + repopulated from adapter B.
    expect(captured!.store.hasNode('a1')).toBe(false);
    expect(captured!.store.hasNode('b1')).toBe(true);
    expect(captured!.store.hasNode('b2')).toBe(true);
  });

  it('cycles isReady false→true when adapter swaps', async () => {
    const adapterA = adapterFor(dataA);
    const adapterB = adapterFor(dataB);
    const readyHistory: boolean[] = [];
    const { rerender } = render(
      <GraphProvider adapter={adapterA}>
        <ContextReader onContext={(ctx) => readyHistory.push(ctx.isReady)} />
      </GraphProvider>,
    );
    await act(async () => {});
    expect(readyHistory).toContain(true);
    const beforeSwap = readyHistory.length;

    rerender(
      <GraphProvider adapter={adapterB}>
        <ContextReader onContext={(ctx) => readyHistory.push(ctx.isReady)} />
      </GraphProvider>,
    );
    await act(async () => {});

    // After swap there should be at least one false-then-true cycle.
    const afterSwap = readyHistory.slice(beforeSwap);
    expect(afterSwap.some((r) => r === false)).toBe(true);
    expect(afterSwap[afterSwap.length - 1]).toBe(true);
  });

  it('calls getInitialView on the new adapter after swap', async () => {
    const adapterA = adapterFor(dataA);
    const adapterB = adapterFor(dataB);
    const { rerender } = render(<GraphProvider adapter={adapterA} />);
    await act(async () => {});
    expect(adapterA.getInitialView).toHaveBeenCalledTimes(1);
    expect(adapterB.getInitialView).toHaveBeenCalledTimes(0);

    rerender(<GraphProvider adapter={adapterB} />);
    await act(async () => {});
    expect(adapterB.getInitialView).toHaveBeenCalledTimes(1);
  });

  it('exposes memoryManager on context', async () => {
    let captured: ReturnType<typeof useGraphContext> | null = null;
    await act(async () => {
      render(
        <GraphProvider data={dataA}>
          <ContextReader onContext={(ctx) => { captured = ctx; }} />
        </GraphProvider>,
      );
    });
    expect(captured!.memoryManager).toBeDefined();
    expect(captured!.memoryManager.cap).toBeUndefined();
  });

  it('memoryManager honors maxNodes prop', async () => {
    let captured: ReturnType<typeof useGraphContext> | null = null;
    await act(async () => {
      render(
        <GraphProvider data={dataA} maxNodes={42}>
          <ContextReader onContext={(ctx) => { captured = ctx; }} />
        </GraphProvider>,
      );
    });
    expect(captured!.memoryManager.cap).toBe(42);
  });

  it('exposes the slug cache on context (shared between hooks)', async () => {
    let first: ReturnType<typeof useGraphContext> | null = null;
    let second: ReturnType<typeof useGraphContext> | null = null;
    const { rerender } = render(
      <GraphProvider data={dataA}>
        <ContextReader onContext={(ctx) => { first = ctx; }} />
      </GraphProvider>,
    );
    await act(async () => {});
    rerender(
      <GraphProvider data={dataA}>
        <ContextReader onContext={(ctx) => { second = ctx; }} />
      </GraphProvider>,
    );
    await act(async () => {});
    // Slug cache identity is stable across renders (mutated in place).
    expect(first!.slugCache).toBe(second!.slugCache);
  });
});
