import { describe, it, expect, vi } from 'vitest';
import { Datasource } from '../../src/data/Datasource.js';
import type { DataAdapterConfig } from '../../src/data/DataAdapter.js';
import type {
  NodeId, NodeData, GraphData, ContentData,
  PaginationOptions, PaginatedResult, DataFilter,
} from '../../src/types.js';

class TestDatasource extends Datasource {
  readonly name = 'test-datasource';
  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getInitialView(_config?: DataAdapterConfig): Promise<GraphData> {
    return { nodes: [], edges: [] };
  }

  async getNode(_id: NodeId): Promise<NodeData | undefined> {
    return undefined;
  }

  async getNeighbors(_nodeId: NodeId, _depth?: number): Promise<GraphData> {
    return { nodes: [], edges: [] };
  }

  async findPath(_fromId: NodeId, _toId: NodeId): Promise<GraphData> {
    return { nodes: [], edges: [] };
  }

  async search(_query: string, _pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>> {
    return { items: [], total: 0, hasMore: false };
  }

  async filter(_filter: DataFilter, _pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>> {
    return { items: [], total: 0, hasMore: false };
  }

  async getContent(_nodeId: NodeId): Promise<ContentData | undefined> {
    return undefined;
  }
}

describe('Datasource', () => {
  it('should not be instantiable directly', () => {
    // TypeScript prevents instantiation of abstract classes at compile time.
    // At runtime we verify our concrete subclass works.
    expect(() => new TestDatasource()).not.toThrow();
  });

  it('should require concrete subclass to implement name', () => {
    const ds = new TestDatasource();
    expect(ds.name).toBe('test-datasource');
  });

  describe('connect / disconnect lifecycle', () => {
    it('should not be connected initially', () => {
      const ds = new TestDatasource();
      expect(ds.isConnected()).toBe(false);
    });

    it('should connect successfully', async () => {
      const ds = new TestDatasource();
      await ds.connect();
      expect(ds.isConnected()).toBe(true);
    });

    it('should disconnect successfully', async () => {
      const ds = new TestDatasource();
      await ds.connect();
      await ds.disconnect();
      expect(ds.isConnected()).toBe(false);
    });
  });

  describe('DataAdapter interface compliance', () => {
    it('should implement getInitialView', async () => {
      const ds = new TestDatasource();
      const result = await ds.getInitialView();
      expect(result).toEqual({ nodes: [], edges: [] });
    });

    it('should implement getNode', async () => {
      const ds = new TestDatasource();
      const result = await ds.getNode('any');
      expect(result).toBeUndefined();
    });

    it('should implement getNeighbors', async () => {
      const ds = new TestDatasource();
      const result = await ds.getNeighbors('any');
      expect(result).toEqual({ nodes: [], edges: [] });
    });

    it('should implement findPath', async () => {
      const ds = new TestDatasource();
      const result = await ds.findPath('a', 'b');
      expect(result).toEqual({ nodes: [], edges: [] });
    });

    it('should implement search', async () => {
      const ds = new TestDatasource();
      const result = await ds.search('query');
      expect(result).toEqual({ items: [], total: 0, hasMore: false });
    });

    it('should implement filter', async () => {
      const ds = new TestDatasource();
      const result = await ds.filter({ types: ['test'] });
      expect(result).toEqual({ items: [], total: 0, hasMore: false });
    });

    it('should implement getContent', async () => {
      const ds = new TestDatasource();
      const result = await ds.getContent('any');
      expect(result).toBeUndefined();
    });
  });

  it('should be assignable to DataAdapter type', () => {
    const ds: TestDatasource = new TestDatasource();
    // Verify the datasource satisfies the DataAdapter interface
    // by checking all required methods exist
    expect(typeof ds.getInitialView).toBe('function');
    expect(typeof ds.getNode).toBe('function');
    expect(typeof ds.getNeighbors).toBe('function');
    expect(typeof ds.findPath).toBe('function');
    expect(typeof ds.search).toBe('function');
    expect(typeof ds.filter).toBe('function');
    expect(typeof ds.getContent).toBe('function');
  });
});
