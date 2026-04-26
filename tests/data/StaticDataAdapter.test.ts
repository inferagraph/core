import { describe, it, expect, beforeEach } from 'vitest';
import { StaticDataAdapter } from '../../src/data/StaticDataAdapter.js';
import type { GraphData } from '../../src/types.js';

describe('StaticDataAdapter', () => {
  let adapter: StaticDataAdapter;
  let testData: GraphData;

  beforeEach(() => {
    testData = {
      nodes: [
        { id: 'a', attributes: { name: 'Adam', type: 'person', tags: ['patriarch'] } },
        { id: 'b', attributes: { name: 'Eve', type: 'person', tags: ['matriarch'] } },
        { id: 'c', attributes: { name: 'Cain', type: 'person', tags: ['patriarch', 'firstborn'] } },
        { id: 'd', attributes: { name: 'Abel', type: 'person', tags: ['shepherd'] } },
        { id: 'e', attributes: { name: 'Eden', type: 'place', tags: ['garden'] } },
        {
          id: 'f',
          attributes: {
            name: 'Seth',
            type: 'person',
            tags: ['patriarch'],
            content: 'Seth was the third son of Adam and Eve.',
            contentType: 'markdown',
          },
        },
      ],
      edges: [
        { id: 'e1', sourceId: 'a', targetId: 'b', attributes: { type: 'husband_of' } },
        { id: 'e2', sourceId: 'a', targetId: 'c', attributes: { type: 'father_of' } },
        { id: 'e3', sourceId: 'a', targetId: 'd', attributes: { type: 'father_of' } },
        { id: 'e4', sourceId: 'b', targetId: 'c', attributes: { type: 'mother_of' } },
        { id: 'e5', sourceId: 'b', targetId: 'd', attributes: { type: 'mother_of' } },
        { id: 'e6', sourceId: 'a', targetId: 'e', attributes: { type: 'lived_in' } },
        { id: 'e7', sourceId: 'a', targetId: 'f', attributes: { type: 'father_of' } },
        { id: 'e8', sourceId: 'b', targetId: 'f', attributes: { type: 'mother_of' } },
      ],
    };
    adapter = new StaticDataAdapter(testData);
  });

  describe('getInitialView', () => {
    it('should return all data', async () => {
      const result = await adapter.getInitialView();
      expect(result.nodes).toEqual(testData.nodes);
      expect(result.edges).toEqual(testData.edges);
    });

    it('should return data regardless of config', async () => {
      const result = await adapter.getInitialView({ someOption: true });
      expect(result.nodes).toHaveLength(testData.nodes.length);
    });
  });

  describe('getNode', () => {
    it('should find a node by ID', async () => {
      const node = await adapter.getNode('a');
      expect(node).toBeDefined();
      expect(node!.id).toBe('a');
      expect(node!.attributes.name).toBe('Adam');
    });

    it('should return undefined for missing node', async () => {
      const node = await adapter.getNode('nonexistent');
      expect(node).toBeUndefined();
    });
  });

  describe('getNeighbors', () => {
    it('should return 1-hop neighbors by default', async () => {
      const result = await adapter.getNeighbors('a');
      const nodeIds = result.nodes.map(n => n.id);
      // Adam is connected to Eve(b), Cain(c), Abel(d), Eden(e), Seth(f)
      expect(nodeIds).toContain('a'); // origin included
      expect(nodeIds).toContain('b');
      expect(nodeIds).toContain('c');
      expect(nodeIds).toContain('d');
      expect(nodeIds).toContain('e');
      expect(nodeIds).toContain('f');
      expect(nodeIds).toHaveLength(6);
    });

    it('should return only edges between included nodes', async () => {
      // Get neighbors of Eden (only connected to Adam)
      const result = await adapter.getNeighbors('e');
      const nodeIds = result.nodes.map(n => n.id);
      expect(nodeIds).toContain('e');
      expect(nodeIds).toContain('a');
      expect(nodeIds).toHaveLength(2);
      // Only the edge e6 connects a and e
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].id).toBe('e6');
    });

    it('should return 2-hop neighbors when depth=2', async () => {
      // Start from Eden (e) -> 1-hop: Adam (a) -> 2-hop: Eve(b), Cain(c), Abel(d), Seth(f)
      const result = await adapter.getNeighbors('e', 2);
      const nodeIds = result.nodes.map(n => n.id);
      expect(nodeIds).toContain('e');
      expect(nodeIds).toContain('a');
      expect(nodeIds).toContain('b');
      expect(nodeIds).toContain('c');
      expect(nodeIds).toContain('d');
      expect(nodeIds).toContain('f');
      expect(nodeIds).toHaveLength(6);
    });

    it('should handle a node with no neighbors', async () => {
      const isolatedData: GraphData = {
        nodes: [{ id: 'x', attributes: { name: 'Isolated' } }],
        edges: [],
      };
      const isolatedAdapter = new StaticDataAdapter(isolatedData);
      const result = await isolatedAdapter.getNeighbors('x');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('x');
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('findPath', () => {
    it('should find shortest path between connected nodes', async () => {
      // Path from Cain(c) to Abel(d): c -> a -> d (through Adam) or c -> b -> d (through Eve)
      const result = await adapter.findPath('c', 'd');
      expect(result.nodes.length).toBeGreaterThanOrEqual(3);
      const nodeIds = result.nodes.map(n => n.id);
      expect(nodeIds).toContain('c');
      expect(nodeIds).toContain('d');
    });

    it('should find direct path between directly connected nodes', async () => {
      // Adam(a) and Eve(b) are directly connected
      const result = await adapter.findPath('a', 'b');
      const nodeIds = result.nodes.map(n => n.id);
      expect(nodeIds).toContain('a');
      expect(nodeIds).toContain('b');
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
    });

    it('should return empty graph for disconnected nodes', async () => {
      const disconnectedData: GraphData = {
        nodes: [
          { id: 'x', attributes: { name: 'X' } },
          { id: 'y', attributes: { name: 'Y' } },
        ],
        edges: [],
      };
      const disconnectedAdapter = new StaticDataAdapter(disconnectedData);
      const result = await disconnectedAdapter.findPath('x', 'y');
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('should return empty graph when source node does not exist', async () => {
      const result = await adapter.findPath('nonexistent', 'a');
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('should return single node path when source equals target', async () => {
      const result = await adapter.findPath('a', 'a');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('a');
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('search', () => {
    it('should match string attribute values case-insensitively', async () => {
      const result = await adapter.search('adam');
      // Matches node 'a' (name: Adam) and node 'f' (content contains "Adam")
      expect(result.items).toHaveLength(2);
      const ids = result.items.map(n => n.id);
      expect(ids).toContain('a');
      expect(ids).toContain('f');
    });

    it('should match string array attribute values', async () => {
      const result = await adapter.search('patriarch');
      expect(result.items.length).toBeGreaterThanOrEqual(2);
      const ids = result.items.map(n => n.id);
      expect(ids).toContain('a');
      expect(ids).toContain('c');
      expect(ids).toContain('f');
    });

    it('should return empty results for no match', async () => {
      const result = await adapter.search('nonexistent_query');
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('should be case-insensitive', async () => {
      const result = await adapter.search('EDEN');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('e');
    });

    it('should support pagination', async () => {
      const result = await adapter.search('person', { offset: 0, limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(5); // 5 persons
      expect(result.hasMore).toBe(true);
    });

    it('should support pagination offset', async () => {
      const allResults = await adapter.search('person');
      const page2 = await adapter.search('person', { offset: 2, limit: 2 });
      expect(page2.items).toHaveLength(2);
      expect(page2.items[0].id).toBe(allResults.items[2].id);
    });
  });

  describe('filter', () => {
    it('should filter by types', async () => {
      const result = await adapter.filter({ types: ['place'] });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('e');
    });

    it('should filter by tags', async () => {
      const result = await adapter.filter({ tags: ['shepherd'] });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('d');
    });

    it('should filter by attributes', async () => {
      const result = await adapter.filter({ attributes: { name: 'Eve' } });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('b');
    });

    it('should combine multiple filter criteria (AND logic)', async () => {
      // Filter for type=person AND tags includes 'patriarch'
      const result = await adapter.filter({ types: ['person'], tags: ['patriarch'] });
      const ids = result.items.map(n => n.id);
      expect(ids).toContain('a');
      expect(ids).toContain('c');
      expect(ids).toContain('f');
      expect(ids).not.toContain('b'); // Eve is person but not patriarch
      expect(ids).not.toContain('e'); // Eden is place
    });

    it('should filter with search text', async () => {
      const result = await adapter.filter({ search: 'adam' });
      // Matches node 'a' (name: Adam) and node 'f' (content contains "Adam")
      expect(result.items).toHaveLength(2);
      const ids = result.items.map(n => n.id);
      expect(ids).toContain('a');
      expect(ids).toContain('f');
    });

    it('should return all nodes when no filter criteria provided', async () => {
      const result = await adapter.filter({});
      expect(result.items).toHaveLength(testData.nodes.length);
    });

    it('should support pagination', async () => {
      const result = await adapter.filter({ types: ['person'] }, { offset: 0, limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(true);
    });

    it('should return empty when no nodes match tags filter', async () => {
      const result = await adapter.filter({ tags: ['nonexistent'] });
      expect(result.items).toHaveLength(0);
    });

    it('should handle nodes without tags attribute', async () => {
      const dataWithMissingTags: GraphData = {
        nodes: [
          { id: 'x', attributes: { name: 'NoTags', type: 'test' } },
          { id: 'y', attributes: { name: 'HasTags', type: 'test', tags: ['hello'] } },
        ],
        edges: [],
      };
      const localAdapter = new StaticDataAdapter(dataWithMissingTags);
      const result = await localAdapter.filter({ tags: ['hello'] });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('y');
    });
  });

  describe('getContent', () => {
    it('should return content when available', async () => {
      const content = await adapter.getContent('f');
      expect(content).toBeDefined();
      expect(content!.nodeId).toBe('f');
      expect(content!.content).toBe('Seth was the third son of Adam and Eve.');
      expect(content!.contentType).toBe('markdown');
    });

    it('should return undefined when no content attribute', async () => {
      const content = await adapter.getContent('a');
      expect(content).toBeUndefined();
    });

    it('should return undefined for missing node', async () => {
      const content = await adapter.getContent('nonexistent');
      expect(content).toBeUndefined();
    });

    it('should default contentType to text', async () => {
      const dataWithPlainContent: GraphData = {
        nodes: [
          { id: 'x', attributes: { name: 'Test', content: 'Some text' } },
        ],
        edges: [],
      };
      const localAdapter = new StaticDataAdapter(dataWithPlainContent);
      const content = await localAdapter.getContent('x');
      expect(content).toBeDefined();
      expect(content!.contentType).toBe('text');
    });
  });

  describe('pagination', () => {
    it('should return all items when no pagination provided', async () => {
      const result = await adapter.search('person');
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(result.items.length);
    });

    it('should correctly calculate hasMore', async () => {
      const result = await adapter.filter({ types: ['person'] }, { offset: 0, limit: 100 });
      expect(result.hasMore).toBe(false);
      expect(result.items).toHaveLength(5);
    });

    it('should handle offset beyond available items', async () => {
      const result = await adapter.filter({ types: ['person'] }, { offset: 100, limit: 10 });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(false);
    });

    it('should handle limit of zero', async () => {
      const result = await adapter.filter({ types: ['person'] }, { offset: 0, limit: 0 });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(5);
      expect(result.hasMore).toBe(true);
    });
  });
});
