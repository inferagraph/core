import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataManager } from '../../src/data/DataManager.js';
import type { DataAdapter } from '../../src/data/DataAdapter.js';
import type { GraphData, NodeData, ContentData, PaginatedResult } from '../../src/types.js';

describe('DataManager', () => {
  let mockAdapter: DataAdapter;
  let mockStore: { merge: ReturnType<typeof vi.fn> };
  let manager: DataManager;

  const sampleGraphData: GraphData = {
    nodes: [
      { id: 'n1', attributes: { name: 'Node1' } },
      { id: 'n2', attributes: { name: 'Node2' } },
    ],
    edges: [
      { id: 'e1', sourceId: 'n1', targetId: 'n2', attributes: { type: 'related_to' } },
    ],
  };

  const neighborData: GraphData = {
    nodes: [
      { id: 'n1', attributes: { name: 'Node1' } },
      { id: 'n3', attributes: { name: 'Node3' } },
    ],
    edges: [
      { id: 'e2', sourceId: 'n1', targetId: 'n3', attributes: { type: 'connected_to' } },
    ],
  };

  const pathData: GraphData = {
    nodes: [
      { id: 'n1', attributes: { name: 'Node1' } },
      { id: 'n2', attributes: { name: 'Node2' } },
      { id: 'n3', attributes: { name: 'Node3' } },
    ],
    edges: [
      { id: 'e1', sourceId: 'n1', targetId: 'n2', attributes: { type: 'connects' } },
      { id: 'e2', sourceId: 'n2', targetId: 'n3', attributes: { type: 'connects' } },
    ],
  };

  const searchResults: PaginatedResult<NodeData> = {
    items: [{ id: 'n1', attributes: { name: 'Node1' } }],
    total: 1,
    hasMore: false,
  };

  const contentData: ContentData = {
    nodeId: 'n1',
    content: 'Detailed content for node 1',
    contentType: 'markdown',
  };

  beforeEach(() => {
    mockAdapter = {
      getInitialView: vi.fn().mockResolvedValue(sampleGraphData),
      getNode: vi.fn().mockResolvedValue(sampleGraphData.nodes[0]),
      getNeighbors: vi.fn().mockResolvedValue(neighborData),
      findPath: vi.fn().mockResolvedValue(pathData),
      search: vi.fn().mockResolvedValue(searchResults),
      filter: vi.fn().mockResolvedValue(searchResults),
      getContent: vi.fn().mockResolvedValue(contentData),
    };

    mockStore = {
      merge: vi.fn(),
    };

    // Cast mockStore to satisfy the constructor's expected type
    manager = new DataManager(mockStore as never, mockAdapter);
  });

  describe('isInitialized', () => {
    it('should be false before initialize is called', () => {
      expect(manager.isInitialized).toBe(false);
    });

    it('should be true after initialize is called', async () => {
      await manager.initialize();
      expect(manager.isInitialized).toBe(true);
    });
  });

  describe('initialize', () => {
    it('should call adapter.getInitialView', async () => {
      await manager.initialize();
      expect(mockAdapter.getInitialView).toHaveBeenCalledOnce();
    });

    it('should pass config to adapter.getInitialView', async () => {
      const config = { maxNodes: 100 };
      await manager.initialize(config);
      expect(mockAdapter.getInitialView).toHaveBeenCalledWith(config);
    });

    it('should merge initial data into store', async () => {
      await manager.initialize();
      expect(mockStore.merge).toHaveBeenCalledWith(sampleGraphData);
    });

    it('should track fetched nodes', async () => {
      await manager.initialize();
      expect(manager.hasFetched('n1')).toBe(true);
      expect(manager.hasFetched('n2')).toBe(true);
    });
  });

  describe('expandNode', () => {
    it('should call adapter.getNeighbors with nodeId', async () => {
      await manager.expandNode('n1');
      expect(mockAdapter.getNeighbors).toHaveBeenCalledWith('n1', undefined);
    });

    it('should pass depth parameter to adapter', async () => {
      await manager.expandNode('n1', 2);
      expect(mockAdapter.getNeighbors).toHaveBeenCalledWith('n1', 2);
    });

    it('should merge neighbor data into store', async () => {
      await manager.expandNode('n1');
      expect(mockStore.merge).toHaveBeenCalledWith(neighborData);
    });

    it('should track newly fetched nodes', async () => {
      await manager.expandNode('n1');
      expect(manager.hasFetched('n1')).toBe(true);
      expect(manager.hasFetched('n3')).toBe(true);
    });

    it('should always fetch even if node was previously fetched', async () => {
      await manager.initialize(); // fetches n1, n2
      await manager.expandNode('n1');
      expect(mockAdapter.getNeighbors).toHaveBeenCalledOnce();
    });
  });

  describe('findPath', () => {
    it('should call adapter.findPath with fromId and toId', async () => {
      await manager.findPath('n1', 'n3');
      expect(mockAdapter.findPath).toHaveBeenCalledWith('n1', 'n3');
    });

    it('should merge path data into store', async () => {
      await manager.findPath('n1', 'n3');
      expect(mockStore.merge).toHaveBeenCalledWith(pathData);
    });

    it('should return path nodes', async () => {
      const result = await manager.findPath('n1', 'n3');
      expect(result).toEqual(pathData.nodes);
    });

    it('should track fetched nodes from path', async () => {
      await manager.findPath('n1', 'n3');
      expect(manager.hasFetched('n1')).toBe(true);
      expect(manager.hasFetched('n2')).toBe(true);
      expect(manager.hasFetched('n3')).toBe(true);
    });
  });

  describe('search', () => {
    it('should delegate to adapter.search', async () => {
      const result = await manager.search('Node1');
      expect(mockAdapter.search).toHaveBeenCalledWith('Node1');
      expect(result).toEqual(searchResults);
    });

    it('should NOT merge search results into store', async () => {
      await manager.search('Node1');
      expect(mockStore.merge).not.toHaveBeenCalled();
    });
  });

  describe('getContent', () => {
    it('should delegate to adapter.getContent', async () => {
      const result = await manager.getContent('n1');
      expect(mockAdapter.getContent).toHaveBeenCalledWith('n1');
      expect(result).toEqual(contentData);
    });

    it('should return undefined when adapter returns undefined', async () => {
      (mockAdapter.getContent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const result = await manager.getContent('n99');
      expect(result).toBeUndefined();
    });
  });

  describe('hasFetched', () => {
    it('should return false for nodes not yet fetched', () => {
      expect(manager.hasFetched('n1')).toBe(false);
    });

    it('should return true for nodes fetched via initialize', async () => {
      await manager.initialize();
      expect(manager.hasFetched('n1')).toBe(true);
    });

    it('should return true for nodes fetched via expandNode', async () => {
      await manager.expandNode('n1');
      expect(manager.hasFetched('n3')).toBe(true);
    });

    it('should return true for nodes fetched via findPath', async () => {
      await manager.findPath('n1', 'n3');
      expect(manager.hasFetched('n2')).toBe(true);
    });
  });
});
