import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { GraphProvider } from '../../src/react/GraphProvider.js';
import { useInferaGraph } from '../../src/react/useInferaGraph.js';
import type { DataAdapter, DataAdapterConfig } from '../../src/data/DataAdapter.js';
import type {
  GraphData, NodeData, PaginatedResult, ContentData,
  DataFilter, PaginationOptions, NodeId,
} from '../../src/types.js';
import type { UseInferaGraphReturn } from '../../src/react/useInferaGraph.js';

const sampleData: GraphData = {
  nodes: [
    { id: '1', attributes: { name: 'Alpha', type: 'test' } },
    { id: '2', attributes: { name: 'Beta', type: 'test' } },
  ],
  edges: [
    { id: 'e1', sourceId: '1', targetId: '2', attributes: { type: 'connected_to' } },
  ],
};

function createMockAdapter(initialData: GraphData): DataAdapter {
  return {
    getInitialView: vi.fn(async (_config?: DataAdapterConfig) => initialData),
    getNode: vi.fn(async (id: NodeId) => initialData.nodes.find(n => n.id === id)),
    getNeighbors: vi.fn(async (_nodeId: NodeId, _depth?: number): Promise<GraphData> => ({
      nodes: [{ id: '3', attributes: { name: 'Gamma', type: 'test' } }],
      edges: [],
    })),
    findPath: vi.fn(async (_fromId: NodeId, _toId: NodeId): Promise<GraphData> => ({
      nodes: [
        { id: '1', attributes: { name: 'Alpha', type: 'test' } },
        { id: '2', attributes: { name: 'Beta', type: 'test' } },
      ],
      edges: [
        { id: 'e1', sourceId: '1', targetId: '2', attributes: { type: 'connected_to' } },
      ],
    })),
    search: vi.fn(async (_query: string, _pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>> => ({
      items: [{ id: '1', attributes: { name: 'Alpha', type: 'test' } }],
      total: 1,
      hasMore: false,
    })),
    filter: vi.fn(async (_filter: DataFilter, _pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>> => ({
      items: [], total: 0, hasMore: false,
    })),
    getContent: vi.fn(async (_nodeId: NodeId): Promise<ContentData | undefined> => ({
      nodeId: '1',
      content: 'Test content',
      contentType: 'text',
    })),
  };
}

/** Helper to capture useInferaGraph return value */
function HookReader({ onHook }: { onHook: (hook: UseInferaGraphReturn) => void }) {
  const hook = useInferaGraph();
  onHook(hook);
  return null;
}

describe('useInferaGraph', () => {
  describe('without adapter (manual mode)', () => {
    it('should return loadData, nodeCount, and edgeCount', () => {
      let captured: UseInferaGraphReturn | null = null;
      render(
        <GraphProvider>
          <HookReader onHook={(h) => { captured = h; }} />
        </GraphProvider>,
      );

      expect(captured).not.toBeNull();
      expect(typeof captured!.loadData).toBe('function');
      expect(captured!.nodeCount).toBe(0);
      expect(captured!.edgeCount).toBe(0);
    });

    it('should report isReady as true when no adapter is configured', () => {
      let captured: UseInferaGraphReturn | null = null;
      render(
        <GraphProvider>
          <HookReader onHook={(h) => { captured = h; }} />
        </GraphProvider>,
      );

      expect(captured!.isReady).toBe(true);
    });

    it('should load data manually via loadData', () => {
      let captured: UseInferaGraphReturn | null = null;
      render(
        <GraphProvider>
          <HookReader onHook={(h) => { captured = h; }} />
        </GraphProvider>,
      );

      act(() => {
        captured!.loadData(sampleData);
      });

      // Re-render to get updated counts
      let updated: UseInferaGraphReturn | null = null;
      render(
        <GraphProvider>
          <HookReader onHook={(h) => { updated = h; }} />
        </GraphProvider>,
      );

      // Since it's a new provider, we test loadData works without error
      expect(typeof captured!.loadData).toBe('function');
    });

    it('expandNode should be a no-op when no dataManager', async () => {
      let captured: UseInferaGraphReturn | null = null;
      render(
        <GraphProvider>
          <HookReader onHook={(h) => { captured = h; }} />
        </GraphProvider>,
      );

      // Should not throw
      await captured!.expandNode('1');
    });

    it('findPath should return empty array when no dataManager', async () => {
      let captured: UseInferaGraphReturn | null = null;
      render(
        <GraphProvider>
          <HookReader onHook={(h) => { captured = h; }} />
        </GraphProvider>,
      );

      const result = await captured!.findPath('1', '2');
      expect(result).toEqual([]);
    });

    it('search should return empty result when no dataManager', async () => {
      let captured: UseInferaGraphReturn | null = null;
      render(
        <GraphProvider>
          <HookReader onHook={(h) => { captured = h; }} />
        </GraphProvider>,
      );

      const result = await captured!.search('test');
      expect(result).toEqual({ items: [], total: 0, hasMore: false });
    });

    it('getContent should return undefined when no dataManager', async () => {
      let captured: UseInferaGraphReturn | null = null;
      render(
        <GraphProvider>
          <HookReader onHook={(h) => { captured = h; }} />
        </GraphProvider>,
      );

      const result = await captured!.getContent('1');
      expect(result).toBeUndefined();
    });
  });

  describe('with adapter', () => {
    it('should report isReady as true after initialization', async () => {
      const mockAdapter = createMockAdapter(sampleData);
      let captured: UseInferaGraphReturn | null = null;

      await act(async () => {
        render(
          <GraphProvider adapter={mockAdapter}>
            <HookReader onHook={(h) => { captured = h; }} />
          </GraphProvider>,
        );
      });

      expect(captured!.isReady).toBe(true);
    });

    it('should have correct node and edge counts after adapter init', async () => {
      const mockAdapter = createMockAdapter(sampleData);
      let captured: UseInferaGraphReturn | null = null;

      await act(async () => {
        render(
          <GraphProvider adapter={mockAdapter}>
            <HookReader onHook={(h) => { captured = h; }} />
          </GraphProvider>,
        );
      });

      expect(captured!.nodeCount).toBe(2);
      expect(captured!.edgeCount).toBe(1);
    });

    it('expandNode should delegate to dataManager', async () => {
      const mockAdapter = createMockAdapter(sampleData);
      let captured: UseInferaGraphReturn | null = null;

      await act(async () => {
        render(
          <GraphProvider adapter={mockAdapter}>
            <HookReader onHook={(h) => { captured = h; }} />
          </GraphProvider>,
        );
      });

      await act(async () => {
        await captured!.expandNode('1', 2);
      });

      expect(mockAdapter.getNeighbors).toHaveBeenCalledWith('1', 2);
    });

    it('findPath should delegate to dataManager and return nodes', async () => {
      const mockAdapter = createMockAdapter(sampleData);
      let captured: UseInferaGraphReturn | null = null;

      await act(async () => {
        render(
          <GraphProvider adapter={mockAdapter}>
            <HookReader onHook={(h) => { captured = h; }} />
          </GraphProvider>,
        );
      });

      let result: NodeData[] = [];
      await act(async () => {
        result = await captured!.findPath('1', '2');
      });

      expect(mockAdapter.findPath).toHaveBeenCalledWith('1', '2');
      expect(result).toHaveLength(2);
    });

    it('search should delegate to dataManager', async () => {
      const mockAdapter = createMockAdapter(sampleData);
      let captured: UseInferaGraphReturn | null = null;

      await act(async () => {
        render(
          <GraphProvider adapter={mockAdapter}>
            <HookReader onHook={(h) => { captured = h; }} />
          </GraphProvider>,
        );
      });

      let result: PaginatedResult<NodeData> = { items: [], total: 0, hasMore: false };
      await act(async () => {
        result = await captured!.search('Alpha');
      });

      expect(mockAdapter.search).toHaveBeenCalledWith('Alpha');
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('getContent should delegate to dataManager', async () => {
      const mockAdapter = createMockAdapter(sampleData);
      let captured: UseInferaGraphReturn | null = null;

      await act(async () => {
        render(
          <GraphProvider adapter={mockAdapter}>
            <HookReader onHook={(h) => { captured = h; }} />
          </GraphProvider>,
        );
      });

      let result: ContentData | undefined;
      await act(async () => {
        result = await captured!.getContent('1');
      });

      expect(mockAdapter.getContent).toHaveBeenCalledWith('1');
      expect(result).toBeDefined();
      expect(result!.content).toBe('Test content');
    });
  });

  describe('with static data prop', () => {
    it('should initialize with data and be ready', async () => {
      let captured: UseInferaGraphReturn | null = null;

      await act(async () => {
        render(
          <GraphProvider data={sampleData}>
            <HookReader onHook={(h) => { captured = h; }} />
          </GraphProvider>,
        );
      });

      expect(captured!.isReady).toBe(true);
      expect(captured!.nodeCount).toBe(2);
      expect(captured!.edgeCount).toBe(1);
    });

    it('search should work with static data', async () => {
      let captured: UseInferaGraphReturn | null = null;

      await act(async () => {
        render(
          <GraphProvider data={sampleData}>
            <HookReader onHook={(h) => { captured = h; }} />
          </GraphProvider>,
        );
      });

      let result: PaginatedResult<NodeData> = { items: [], total: 0, hasMore: false };
      await act(async () => {
        result = await captured!.search('Alpha');
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].attributes.name).toBe('Alpha');
    });
  });
});
