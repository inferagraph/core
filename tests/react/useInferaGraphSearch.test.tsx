import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/renderer/SceneController.js', () => ({
  SceneController: vi.fn().mockImplementation(() => ({
    attach: vi.fn(),
    detach: vi.fn(),
    syncFromStore: vi.fn(),
    setLayout: vi.fn(),
    setNodeRender: vi.fn(),
    setTooltip: vi.fn(),
    setIncomingEdgeLabels: vi.fn(),
    setOutgoingEdgeLabels: vi.fn(),
    setFilter: vi.fn(),
    setHighlight: vi.fn(),
    focusOn: vi.fn(),
    annotate: vi.fn(),
    clearAnnotations: vi.fn(),
    resize: vi.fn(),
  })),
}));

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { InferaGraph } from '../../src/react/InferaGraph.js';
import { useInferaGraphSearch } from '../../src/react/useInferaGraphSearch.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import { inMemoryEmbeddingStore } from '../../src/ai/InMemoryEmbeddingStore.js';
import type { SearchResult } from '../../src/ai/SearchResult.js';

interface ChildHandle {
  invoke: (msg: string, k?: number) => Promise<SearchResult[]>;
}

function SearchChild({
  handleRef,
}: {
  handleRef: { current: ChildHandle | null };
}): React.ReactElement {
  const { search } = useInferaGraphSearch();
  handleRef.current = {
    invoke: async (msg: string, k?: number) => search(msg, k !== undefined ? { k } : undefined),
  };
  return <span />;
}

describe('useInferaGraphSearch', () => {
  beforeEach(() => {
    // No-op: vi.mock above is hoisted.
  });

  it('throws when used outside <InferaGraph>', () => {
    function Bad(): React.ReactElement {
      useInferaGraphSearch();
      return <span />;
    }
    expect(() => render(<Bad />)).toThrow();
  });

  it('runs keyword search by default (no llm prop)', async () => {
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph
        data={{
          nodes: [
            { id: '1', attributes: { name: 'Adam', type: 'person' } },
            { id: '2', attributes: { name: 'Eve', type: 'person' } },
          ],
          edges: [],
        }}
      >
        <SearchChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    const hits = await act(async () => handle.current!.invoke('adam'));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].nodeId).toBe('1');
    expect(hits[0].matchedField).toBe('name');
  });

  it('routes sentence-shaped queries through the embedding store when wired', async () => {
    const provider = mockLLMProvider({});
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph
        llm={provider}
        embeddingStore={inMemoryEmbeddingStore()}
        data={{
          nodes: [
            { id: '1', attributes: { name: 'Adam', type: 'person' } },
            { id: '2', attributes: { name: 'Eve', type: 'person' } },
          ],
          edges: [],
        }}
      >
        <SearchChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    const hits = await act(async () =>
      handle.current!.invoke('Tell me about the very first humans on Earth.'),
    );
    // mock provider produces deterministic vectors → semantic ranking returns
    // both nodes, ordered by cosine similarity to the query vector.
    expect(Array.isArray(hits)).toBe(true);
    // Provider's embed must have been invoked at least once for the query.
    expect(provider.getEmbedCallCount()).toBeGreaterThanOrEqual(1);
  });

  it('honours k', async () => {
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph
        data={{
          nodes: [
            { id: '1', attributes: { name: 'Adam', type: 'person' } },
            { id: '2', attributes: { name: 'Eve', type: 'person' } },
            { id: '3', attributes: { name: 'Abraham', type: 'person' } },
          ],
          edges: [],
        }}
      >
        <SearchChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    const hits = await act(async () => handle.current!.invoke('person', 1));
    expect(hits.length).toBeLessThanOrEqual(1);
  });
});
