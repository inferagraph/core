import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';

describe('QueryEngine', () => {
  let store: GraphStore;
  let engine: QueryEngine;

  beforeEach(() => {
    store = new GraphStore();
    engine = new QueryEngine(store);

    store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
    store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
    store.addNode('3', { name: 'Cain', type: 'person', gender: 'male' });
    store.addNode('4', { name: 'Abel', type: 'person', gender: 'male' });
    store.addEdge('e1', '1', '2', { type: 'husband_of' });
    store.addEdge('e2', '1', '3', { type: 'father_of' });
    store.addEdge('e3', '1', '4', { type: 'father_of' });
    store.addEdge('e4', '3', '4', { type: 'brother_of' });
  });

  describe('getNeighbors', () => {
    it('should get direct neighbors at depth 1', () => {
      const neighbors = engine.getNeighbors('1', 1);
      expect(neighbors).toHaveLength(3);
    });

    it('should get extended neighbors at depth 2', () => {
      const neighbors = engine.getNeighbors('2', 2);
      expect(neighbors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('findPath', () => {
    it('should find path between connected nodes', () => {
      const path = engine.findPath('2', '3');
      expect(path).not.toBeNull();
      expect(path![0]).toBe('2');
      expect(path![path!.length - 1]).toBe('3');
    });

    it('should return single node path for same node', () => {
      const path = engine.findPath('1', '1');
      expect(path).toEqual(['1']);
    });

    it('should return null for disconnected nodes', () => {
      store.addNode('5', { name: 'Isolated', type: 'person', gender: 'male' });
      const path = engine.findPath('1', '5');
      expect(path).toBeNull();
    });
  });

  describe('getSubgraph', () => {
    it('should return edges within node set', () => {
      const subgraph = engine.getSubgraph(['1', '2']);
      expect(subgraph.nodeIds).toContain('1');
      expect(subgraph.nodeIds).toContain('2');
      expect(subgraph.edgeIds).toContain('e1');
      expect(subgraph.edgeIds).not.toContain('e2');
    });
  });
});
