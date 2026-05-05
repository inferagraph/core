import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { GraphProvider, useGraphContext } from '../../src/react/GraphProvider.js';
import { useInferaGraphContent } from '../../src/react/useInferaGraphContent.js';
import type { MemoryManager } from '../../src/data/MemoryManager.js';
import type {
  DataAdapter,
  DataAdapterConfig,
} from '../../src/data/DataAdapter.js';
import type {
  ContentData,
  GraphData,
  NodeData,
  PaginatedResult,
  PaginationOptions,
  DataFilter,
  NodeId,
} from '../../src/types.js';

const initialData: GraphData = {
  nodes: [
    { id: 'uuid-1', attributes: { name: 'One', type: 'test' } },
    { id: 'uuid-2', attributes: { name: 'Two', type: 'test' } },
  ],
  edges: [],
};

function adapter(
  contentMap: Record<string, ContentData | undefined>,
  failOn?: Set<string>,
): DataAdapter {
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
    getContent: vi.fn(async (id: NodeId): Promise<ContentData | undefined> => {
      if (failOn?.has(id)) throw new Error(`failed-${id}`);
      return contentMap[id];
    }),
  };
}

interface HookResult {
  data: ContentData | undefined;
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

function HookHarness({
  idOrSlug,
  onResult,
}: {
  idOrSlug: string | undefined;
  onResult: (r: HookResult) => void;
}) {
  const result = useInferaGraphContent(idOrSlug);
  onResult(result);
  return null;
}

describe('useInferaGraphContent', () => {
  it('returns disabled state when idOrSlug is undefined', async () => {
    const a = adapter({});
    const states: HookResult[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <HookHarness idOrSlug={undefined} onResult={(r) => states.push(r)} />
        </GraphProvider>,
      );
    });
    const last = states[states.length - 1];
    expect(last.data).toBeUndefined();
    expect(last.loading).toBe(false);
    expect(last.error).toBeUndefined();
    expect(a.getContent).not.toHaveBeenCalled();
  });

  it('fetches and returns content for a UUID input (no resolver)', async () => {
    const content: ContentData = {
      nodeId: 'uuid-1',
      content: '# One',
      contentType: 'markdown',
    };
    const a = adapter({ 'uuid-1': content });
    const states: HookResult[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <HookHarness idOrSlug='uuid-1' onResult={(r) => states.push(r)} />
        </GraphProvider>,
      );
    });
    await waitFor(() => {
      expect(states[states.length - 1].data).toEqual(content);
    });
    expect(states[states.length - 1].loading).toBe(false);
    expect(a.getContent).toHaveBeenCalledWith('uuid-1');
  });

  it('emits a loading=true state before resolving', async () => {
    const content: ContentData = {
      nodeId: 'uuid-1',
      content: 'X',
      contentType: 'markdown',
    };
    const a = adapter({ 'uuid-1': content });
    const states: HookResult[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <HookHarness idOrSlug='uuid-1' onResult={(r) => states.push(r)} />
        </GraphProvider>,
      );
    });
    await waitFor(() => {
      expect(states[states.length - 1].loading).toBe(false);
    });
    expect(states.some((s) => s.loading === true)).toBe(true);
  });

  it('exposes errors from getContent', async () => {
    const a = adapter({}, new Set(['uuid-bad']));
    const states: HookResult[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <HookHarness idOrSlug='uuid-bad' onResult={(r) => states.push(r)} />
        </GraphProvider>,
      );
    });
    await waitFor(() => {
      expect(states[states.length - 1].error).toBeDefined();
    });
    expect(states[states.length - 1].error?.message).toMatch(/failed-uuid-bad/);
    expect(states[states.length - 1].data).toBeUndefined();
    expect(states[states.length - 1].loading).toBe(false);
  });

  it('caches subsequent reads of the same id (no re-fetch)', async () => {
    const content: ContentData = {
      nodeId: 'uuid-1',
      content: 'X',
      contentType: 'markdown',
    };
    const a = adapter({ 'uuid-1': content });
    const states: HookResult[] = [];
    let setIdFromOutside: (s: string) => void = () => {};
    function ToggleHarness() {
      const [id, setId] = React.useState<string | undefined>('uuid-1');
      setIdFromOutside = setId;
      return <HookHarness idOrSlug={id} onResult={(r) => states.push(r)} />;
    }
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <ToggleHarness />
        </GraphProvider>,
      );
    });
    await waitFor(() => {
      expect(states[states.length - 1].data).toEqual(content);
    });
    const callsAfterFirst = (a.getContent as ReturnType<typeof vi.fn>).mock
      .calls.length;
    await act(async () => {
      setIdFromOutside('uuid-2'); // switch
    });
    await act(async () => {
      setIdFromOutside('uuid-1'); // back to cached
    });
    await waitFor(() => {
      expect(states[states.length - 1].data).toEqual(content);
    });
    // For uuid-1 we should NOT have re-fetched: only uuid-2 should have
    // added a call.
    const callsAfter = (a.getContent as ReturnType<typeof vi.fn>).mock.calls
      .length;
    expect(callsAfter).toBe(callsAfterFirst + 1);
  });

  it('runs slug input through the configured resolver', async () => {
    const content: ContentData = {
      nodeId: 'uuid-1',
      content: 'X',
      contentType: 'markdown',
    };
    const a = adapter({ 'uuid-1': content });
    const resolver = vi.fn((slug: string) => {
      if (slug === 'one') return 'uuid-1';
      throw new Error(`unknown slug ${slug}`);
    });
    const states: HookResult[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a} slugResolver={resolver}>
          <HookHarness idOrSlug='one' onResult={(r) => states.push(r)} />
        </GraphProvider>,
      );
    });
    await waitFor(() => {
      expect(states[states.length - 1].data).toEqual(content);
    });
    expect(resolver).toHaveBeenCalledWith('one');
    expect(a.getContent).toHaveBeenCalledWith('uuid-1');
  });

  it('caches the slug→uuid mapping (resolver called once per slug)', async () => {
    const content: ContentData = {
      nodeId: 'uuid-1',
      content: 'X',
      contentType: 'markdown',
    };
    const a = adapter({ 'uuid-1': content });
    const resolver = vi.fn(async (slug: string) => {
      if (slug === 'one') return 'uuid-1';
      throw new Error('nope');
    });
    let setIdFromOutside: (s: string) => void = () => {};
    function ToggleHarness() {
      const [id, setId] = React.useState<string | undefined>('one');
      setIdFromOutside = setId;
      return <HookHarness idOrSlug={id} onResult={() => {}} />;
    }
    await act(async () => {
      render(
        <GraphProvider adapter={a} slugResolver={resolver}>
          <ToggleHarness />
        </GraphProvider>,
      );
    });
    await waitFor(() => {
      expect(a.getContent).toHaveBeenCalled();
    });
    expect(resolver).toHaveBeenCalledTimes(1);
    await act(async () => {
      setIdFromOutside('one');
    });
    // Even after re-rendering with the same slug, resolver shouldn't
    // re-fire — slug→id is cached at the GraphProvider level.
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('refetch re-issues the call', async () => {
    const content: ContentData = {
      nodeId: 'uuid-1',
      content: 'first',
      contentType: 'markdown',
    };
    const a = adapter({ 'uuid-1': content });
    const states: HookResult[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <HookHarness idOrSlug='uuid-1' onResult={(r) => states.push(r)} />
        </GraphProvider>,
      );
    });
    await waitFor(() => {
      expect(states[states.length - 1].data).toEqual(content);
    });
    // Mutate the adapter to return a new value, then refetch.
    (a.getContent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      nodeId: 'uuid-1',
      content: 'second',
      contentType: 'markdown',
    });
    await act(async () => {
      states[states.length - 1].refetch();
    });
    await waitFor(() => {
      expect(states[states.length - 1].data?.content).toBe('second');
    });
  });

  it('touches the MemoryManager on success', async () => {
    const content: ContentData = {
      nodeId: 'uuid-1',
      content: 'X',
      contentType: 'markdown',
    };
    const a = adapter({ 'uuid-1': content });
    let mm: MemoryManager | null = null;
    function MMReader() {
      const { memoryManager } = useGraphContext();
      mm = memoryManager;
      return null;
    }
    const states: HookResult[] = [];
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <MMReader />
          <HookHarness idOrSlug='uuid-1' onResult={(r) => states.push(r)} />
        </GraphProvider>,
      );
    });
    await waitFor(() => {
      expect(states[states.length - 1].data).toEqual(content);
    });
    expect(mm).not.toBeNull();
    expect(mm!.timestamps.has('uuid-1')).toBe(true);
  });

  it('cancels prior fetch when id changes mid-flight (no flicker)', async () => {
    let resolveFirst: (v: ContentData) => void = () => {};
    const a = adapter({});
    (a.getContent as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string) => {
        if (id === 'uuid-1') {
          return new Promise<ContentData>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({
          nodeId: id,
          content: `for-${id}`,
          contentType: 'markdown',
        });
      },
    );
    const states: HookResult[] = [];
    let setIdFromOutside: (s: string) => void = () => {};
    function ToggleHarness() {
      const [id, setId] = React.useState<string | undefined>('uuid-1');
      setIdFromOutside = setId;
      return <HookHarness idOrSlug={id} onResult={(r) => states.push(r)} />;
    }
    await act(async () => {
      render(
        <GraphProvider adapter={a}>
          <ToggleHarness />
        </GraphProvider>,
      );
    });
    // Switch before first request resolves.
    await act(async () => {
      setIdFromOutside('uuid-2');
    });
    await waitFor(() => {
      expect(states[states.length - 1].data?.nodeId).toBe('uuid-2');
    });
    // Now resolve the FIRST request — its result should NOT clobber state.
    await act(async () => {
      resolveFirst({
        nodeId: 'uuid-1',
        content: 'should-not-show',
        contentType: 'markdown',
      });
    });
    expect(states[states.length - 1].data?.nodeId).toBe('uuid-2');
  });
});
