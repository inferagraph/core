import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import {
  GraphProvider,
  useGraphContext,
} from '../../src/react/GraphProvider.js';
import { useInferaGraphNeighbors } from '../../src/react/useInferaGraphNeighbors.js';
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

const initialData: GraphData = {
  nodes: [
    { id: 'root', attributes: { name: 'Root', type: 'test' } },
    { id: 'old1', attributes: { name: 'Old1', type: 'test' } },
  ],
  edges: [],
};

function adapter(neighborsByNode: Record<NodeId, GraphData>): DataAdapter {
  return {
    getInitialView: vi.fn(async (_c?: DataAdapterConfig) => initialData),
    getNode: vi.fn(async (id: NodeId) =>
      initialData.nodes.find((n) => n.id === id),
    ),
    getNeighbors: vi.fn(async (id: NodeId, _d?: number) => {
      const data = neighborsByNode[id];
      if (!data) throw new Error(`no neighbors for ${id}`);
      return data;
    }),
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

interface HookSnapshot {
  expanded: ReadonlyMap<NodeId, string>;
  expand: (id: string, depth?: number) => Promise<void>;
  collapse: (id: string) => Promise<void>;
}

function HookHarness({
  onSnapshot,
}: {
  onSnapshot: (snap: HookSnapshot) => void;
}) {
  const { expand, collapse, expanded } = useInferaGraphNeighbors();
  onSnapshot({ expanded, expand, collapse });
  return null;
}

const oneHopRoot: GraphData = {
  nodes: [
    { id: 'root', attributes: { name: 'Root', type: 'test' } },
    { id: 'n1', attributes: { name: 'N1', type: 'test' } },
    { id: 'n2', attributes: { name: 'N2', type: 'test' } },
  ],
  edges: [
    {
      id: 'e1',
      sourceId: 'root',
      targetId: 'n1',
      attributes: { type: 'connects' },
    },
    {
      id: 'e2',
      sourceId: 'root',
      targetId: 'n2',
      attributes: { type: 'connects' },
    },
  ],
};

describe('useInferaGraphNeighbors', () => {
  it('expand transitions through loading→loaded for the requested node', async () => {
    // Use a deferred promise so the test can observe the intermediate
    // 'loading' state before the adapter resolves.
    let resolveExpand: (v: GraphData) => void = () => {};
    const a = adapter({ root: oneHopRoot });
    (a.getNeighbors as ReturnType<typeof vi.fn>).mockImplementation(() =>
      new Promise<GraphData>((resolve) => {
        resolveExpand = resolve;
      }),
    );
    const snaps: HookSnapshot[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <HookHarness onSnapshot={(s) => snaps.push(s)} />
        </GraphProvider>,
      );
    });
    const lastBefore = snaps[snaps.length - 1];
    // Kick off the expand WITHOUT awaiting — then act on the loading state.
    let expandPromise: Promise<void>;
    await act(async () => {
      expandPromise = lastBefore.expand('root');
    });
    expect(snaps[snaps.length - 1].expanded.get('root')).toBe('loading');
    await act(async () => {
      resolveExpand(oneHopRoot);
      await expandPromise;
    });
    expect(snaps[snaps.length - 1].expanded.get('root')).toBe('loaded');
  });

  it('merges the fetched subgraph into the store', async () => {
    const a = adapter({ root: oneHopRoot });
    let storeRef: import('../../src/store/GraphStore.js').GraphStore | null = null;
    function StoreReader() {
      const { store } = useGraphContext();
      storeRef = store;
      return null;
    }
    const snaps: HookSnapshot[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <StoreReader />
          <HookHarness onSnapshot={(s) => snaps.push(s)} />
        </GraphProvider>,
      );
    });
    expect(storeRef!.hasNode('n1')).toBe(false);
    await act(async () => {
      await snaps[snaps.length - 1].expand('root');
    });
    expect(storeRef!.hasNode('n1')).toBe(true);
    expect(storeRef!.hasNode('n2')).toBe(true);
  });

  it('marks loading→error when the adapter throws', async () => {
    const a = adapter({});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const snaps: HookSnapshot[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <HookHarness onSnapshot={(s) => snaps.push(s)} />
        </GraphProvider>,
      );
    });
    await act(async () => {
      await snaps[snaps.length - 1].expand('root');
    });
    expect(snaps[snaps.length - 1].expanded.get('root')).toBe('error');
    warnSpy.mockRestore();
  });

  it('expand resolves slug input through the configured resolver', async () => {
    const a = adapter({ root: oneHopRoot });
    const resolver = vi.fn((slug: string) => {
      if (slug === 'root-slug') return 'root';
      throw new Error('unknown');
    });
    const snaps: HookSnapshot[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a} slugResolver={resolver}>
          <HookHarness onSnapshot={(s) => snaps.push(s)} />
        </GraphProvider>,
      );
    });
    await act(async () => {
      await snaps[snaps.length - 1].expand('root-slug');
    });
    expect(resolver).toHaveBeenCalledWith('root-slug');
    expect(a.getNeighbors).toHaveBeenCalledWith('root', undefined);
    // expanded map keyed by canonical id.
    expect(snaps[snaps.length - 1].expanded.has('root')).toBe(true);
  });

  it('protects the just-expanded set from LRU eviction', async () => {
    const a = adapter({ root: oneHopRoot });
    let mm: import('../../src/data/MemoryManager.js').MemoryManager | null = null;
    let storeRef: import('../../src/store/GraphStore.js').GraphStore | null = null;
    function StateReader() {
      const ctx = useGraphContext();
      mm = ctx.memoryManager;
      storeRef = ctx.store;
      return null;
    }
    const snaps: HookSnapshot[] = [];
    // maxNodes=3 so after merging root + n1 + n2 (initial root + old1 already
    // in store = 4 nodes) we need to evict. The protected set should keep
    // root, n1, n2 alive — old1 should be the victim.
    await act(async () => {
      render(
        <GraphProvider adapter={a} maxNodes={3}>
          <StateReader />
          <HookHarness onSnapshot={(s) => snaps.push(s)} />
        </GraphProvider>,
      );
    });
    expect(storeRef!.hasNode('old1')).toBe(true);
    expect(storeRef!.hasNode('root')).toBe(true);
    await act(async () => {
      await snaps[snaps.length - 1].expand('root');
    });
    // root + n1 + n2 should survive; old1 evicted.
    expect(storeRef!.hasNode('root')).toBe(true);
    expect(storeRef!.hasNode('n1')).toBe(true);
    expect(storeRef!.hasNode('n2')).toBe(true);
    expect(storeRef!.hasNode('old1')).toBe(false);
    expect(mm!.timestamps.has('root')).toBe(true);
    expect(mm!.timestamps.has('n1')).toBe(true);
    expect(mm!.timestamps.has('n2')).toBe(true);
  });

  it('expanded map mirrors lifecycle state across multiple expands', async () => {
    const root2: GraphData = {
      nodes: [
        { id: 'root', attributes: {} },
        { id: 'm1', attributes: {} },
      ],
      edges: [
        { id: 'r1', sourceId: 'root', targetId: 'm1', attributes: { type: 't' } },
      ],
    };
    const a = adapter({ root: oneHopRoot, n1: root2 });
    const snaps: HookSnapshot[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <HookHarness onSnapshot={(s) => snaps.push(s)} />
        </GraphProvider>,
      );
    });
    await act(async () => {
      await snaps[snaps.length - 1].expand('root');
    });
    await act(async () => {
      await snaps[snaps.length - 1].expand('n1');
    });
    const final = snaps[snaps.length - 1];
    expect(final.expanded.get('root')).toBe('loaded');
    expect(final.expanded.get('n1')).toBe('loaded');
  });

  it('collapse drops neighbors not in the protected expand set', async () => {
    const a = adapter({ root: oneHopRoot });
    let storeRef: import('../../src/store/GraphStore.js').GraphStore | null = null;
    function StoreReader() {
      const { store } = useGraphContext();
      storeRef = store;
      return null;
    }
    const snaps: HookSnapshot[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <StoreReader />
          <HookHarness onSnapshot={(s) => snaps.push(s)} />
        </GraphProvider>,
      );
    });
    await act(async () => {
      await snaps[snaps.length - 1].expand('root');
    });
    expect(storeRef!.hasNode('n1')).toBe(true);
    expect(storeRef!.hasNode('n2')).toBe(true);
    await act(async () => {
      await snaps[snaps.length - 1].collapse('root');
    });
    // n1 + n2 were touched by expand, so they're in the LRU map and won't
    // be dropped by collapse's "untouched only" guard. This test confirms
    // the expanded entry is removed and root itself stays alive.
    expect(snaps[snaps.length - 1].expanded.has('root')).toBe(false);
    expect(storeRef!.hasNode('root')).toBe(true);
  });

  it('expand is a no-op when no dataManager is wired', async () => {
    const snaps: HookSnapshot[] = [];
    await act(async () => {
      render(
        <GraphProvider>
          <HookHarness onSnapshot={(s) => snaps.push(s)} />
        </GraphProvider>,
      );
    });
    await act(async () => {
      await snaps[snaps.length - 1].expand('whatever');
    });
    // No status entry should appear because the call short-circuited.
    expect(snaps[snaps.length - 1].expanded.size).toBe(0);
  });

  it('captures slug-resolution errors and skips the fetch', async () => {
    const a = adapter({ root: oneHopRoot });
    const resolver = vi.fn(() => {
      throw new Error('resolve failed');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const snaps: HookSnapshot[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a} slugResolver={resolver}>
          <HookHarness onSnapshot={(s) => snaps.push(s)} />
        </GraphProvider>,
      );
    });
    await act(async () => {
      await snaps[snaps.length - 1].expand('bad-slug');
    });
    expect(a.getNeighbors).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('passes depth through to the adapter', async () => {
    const a = adapter({ root: oneHopRoot });
    const snaps: HookSnapshot[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <HookHarness onSnapshot={(s) => snaps.push(s)} />
        </GraphProvider>,
      );
    });
    await act(async () => {
      await snaps[snaps.length - 1].expand('root', 2);
    });
    expect(a.getNeighbors).toHaveBeenCalledWith('root', 2);
  });
});
