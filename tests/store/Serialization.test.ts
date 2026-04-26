import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { exportGraph, importGraph } from '../../src/store/Serializer.js';
import type { SerializedGraph } from '../../src/types.js';

describe('Graph Serialization', () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  describe('toJSON', () => {
    it('should serialize an empty graph', () => {
      const json = store.toJSON();
      expect(json.version).toBe(1);
      expect(json.nodes).toEqual([]);
      expect(json.edges).toEqual([]);
      expect(json.metadata.nodeCount).toBe(0);
      expect(json.metadata.edgeCount).toBe(0);
      expect(json.metadata.exportedAt).toBeDefined();
    });

    it('should include exportedAt as a valid ISO string', () => {
      const json = store.toJSON();
      const date = new Date(json.metadata.exportedAt);
      expect(date.toISOString()).toBe(json.metadata.exportedAt);
    });

    it('should serialize nodes with their attributes', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });

      const json = store.toJSON();
      expect(json.nodes).toHaveLength(2);
      expect(json.nodes[0]).toEqual({
        id: '1',
        attributes: { name: 'Adam', type: 'person', gender: 'male' },
      });
      expect(json.nodes[1]).toEqual({
        id: '2',
        attributes: { name: 'Eve', type: 'person', gender: 'female' },
      });
    });

    it('should serialize edges with their attributes', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
      store.addEdge('e1', '1', '2', { type: 'husband_of' });

      const json = store.toJSON();
      expect(json.edges).toHaveLength(1);
      expect(json.edges[0]).toEqual({
        id: 'e1',
        sourceId: '1',
        targetId: '2',
        attributes: { type: 'husband_of' },
      });
    });

    it('should include correct metadata counts', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
      store.addEdge('e1', '1', '2', { type: 'husband_of' });

      const json = store.toJSON();
      expect(json.metadata.nodeCount).toBe(2);
      expect(json.metadata.edgeCount).toBe(1);
    });
  });

  describe('fromJSON', () => {
    it('should round-trip: add data, serialize, clear, deserialize, verify', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
      store.addNode('3', { name: 'Cain', type: 'person', gender: 'male' });
      store.addEdge('e1', '1', '2', { type: 'husband_of' });
      store.addEdge('e2', '1', '3', { type: 'father_of' });

      const serialized = store.toJSON();
      store.clear();
      expect(store.nodeCount).toBe(0);
      expect(store.edgeCount).toBe(0);

      store.fromJSON(serialized);
      expect(store.nodeCount).toBe(3);
      expect(store.edgeCount).toBe(2);
      expect(store.getNode('1')?.attributes.name).toBe('Adam');
      expect(store.getNode('2')?.attributes.name).toBe('Eve');
      expect(store.getNode('3')?.attributes.name).toBe('Cain');
      expect(store.getEdge('e1')?.attributes.type).toBe('husband_of');
      expect(store.getEdge('e2')?.attributes.type).toBe('father_of');
    });

    it('should throw on version mismatch', () => {
      const badData: SerializedGraph = {
        version: 2,
        nodes: [],
        edges: [],
        metadata: { exportedAt: new Date().toISOString(), nodeCount: 0, edgeCount: 0 },
      };
      expect(() => store.fromJSON(badData)).toThrow('Unsupported schema version: 2');
    });

    it('should throw on null input', () => {
      expect(() => store.fromJSON(null as unknown as SerializedGraph)).toThrow(
        'Unsupported schema version',
      );
    });

    it('should throw on undefined input', () => {
      expect(() => store.fromJSON(undefined as unknown as SerializedGraph)).toThrow(
        'Unsupported schema version',
      );
    });

    it('should clear existing data before loading', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });

      const newData: SerializedGraph = {
        version: 1,
        nodes: [{ id: '2', attributes: { name: 'Eve', type: 'person', gender: 'female' } }],
        edges: [],
        metadata: { exportedAt: new Date().toISOString(), nodeCount: 1, edgeCount: 0 },
      };

      store.fromJSON(newData);
      expect(store.nodeCount).toBe(1);
      expect(store.getNode('1')).toBeUndefined();
      expect(store.getNode('2')?.attributes.name).toBe('Eve');
    });
  });

  describe('large graph', () => {
    it('should serialize and deserialize 100+ nodes', () => {
      for (let i = 0; i < 150; i++) {
        store.addNode(`n${i}`, { name: `Node ${i}`, type: 'person' });
      }
      for (let i = 0; i < 100; i++) {
        store.addEdge(`e${i}`, `n${i}`, `n${i + 1}`, { type: 'father_of' });
      }

      const serialized = store.toJSON();
      expect(serialized.nodes).toHaveLength(150);
      expect(serialized.edges).toHaveLength(100);
      expect(serialized.metadata.nodeCount).toBe(150);
      expect(serialized.metadata.edgeCount).toBe(100);

      const newStore = new GraphStore();
      newStore.fromJSON(serialized);
      expect(newStore.nodeCount).toBe(150);
      expect(newStore.edgeCount).toBe(100);
      expect(newStore.getNode('n0')?.attributes.name).toBe('Node 0');
      expect(newStore.getNode('n149')?.attributes.name).toBe('Node 149');
      expect(newStore.getEdge('e99')?.sourceId).toBe('n99');
      expect(newStore.getEdge('e99')?.targetId).toBe('n100');
    });
  });

  describe('exportGraph / importGraph', () => {
    it('should export to JSON string and import back', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
      store.addEdge('e1', '1', '2', { type: 'husband_of' });

      const jsonString = exportGraph(store);
      expect(typeof jsonString).toBe('string');

      const parsed = JSON.parse(jsonString);
      expect(parsed.version).toBe(1);
      expect(parsed.nodes).toHaveLength(2);
      expect(parsed.edges).toHaveLength(1);

      const newStore = new GraphStore();
      importGraph(newStore, jsonString);
      expect(newStore.nodeCount).toBe(2);
      expect(newStore.edgeCount).toBe(1);
      expect(newStore.getNode('1')?.attributes.name).toBe('Adam');
      expect(newStore.getEdge('e1')?.attributes.type).toBe('husband_of');
    });

    it('should produce pretty-printed JSON', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      const jsonString = exportGraph(store);
      expect(jsonString).toContain('\n');
      expect(jsonString).toContain('  ');
    });

    it('should throw on invalid JSON string', () => {
      expect(() => importGraph(store, 'not valid json')).toThrow();
    });

    it('should throw on valid JSON with wrong version', () => {
      const badJson = JSON.stringify({
        version: 99,
        nodes: [],
        edges: [],
        metadata: { exportedAt: new Date().toISOString(), nodeCount: 0, edgeCount: 0 },
      });
      expect(() => importGraph(store, badJson)).toThrow('Unsupported schema version: 99');
    });
  });
});
