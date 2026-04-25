import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';

describe('GraphStore', () => {
  let store: GraphStore;

  beforeEach(() => {
    store = new GraphStore();
  });

  describe('addNode', () => {
    it('should add a node', () => {
      const node = store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      expect(node.id).toBe('1');
      expect(node.attributes.name).toBe('Adam');
      expect(store.nodeCount).toBe(1);
    });

    it('should throw on duplicate id', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      expect(() => store.addNode('1', { name: 'Eve', type: 'person', gender: 'female' })).toThrow();
    });
  });

  describe('removeNode', () => {
    it('should remove a node and its edges', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
      store.addEdge('e1', '1', '2', { type: 'husband_of' });
      store.removeNode('1');
      expect(store.nodeCount).toBe(1);
      expect(store.edgeCount).toBe(0);
    });
  });

  describe('addEdge', () => {
    it('should add an edge between existing nodes', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
      const edge = store.addEdge('e1', '1', '2', { type: 'husband_of' });
      expect(edge.sourceId).toBe('1');
      expect(edge.targetId).toBe('2');
      expect(store.edgeCount).toBe(1);
    });

    it('should throw if source node missing', () => {
      store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
      expect(() => store.addEdge('e1', '1', '2', { type: 'husband_of' })).toThrow();
    });
  });

  describe('getNeighborIds', () => {
    it('should return neighbor ids', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
      store.addNode('3', { name: 'Cain', type: 'person', gender: 'male' });
      store.addEdge('e1', '1', '2', { type: 'husband_of' });
      store.addEdge('e2', '1', '3', { type: 'father_of' });
      const neighbors = store.getNeighborIds('1');
      expect(neighbors).toContain('2');
      expect(neighbors).toContain('3');
      expect(neighbors).toHaveLength(2);
    });
  });

  describe('getNodesByType', () => {
    it('should return nodes filtered by type', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      store.addNode('2', { name: 'Eden', type: 'place' });
      const people = store.getNodesByType('person');
      expect(people).toHaveLength(1);
      expect(people[0].attributes.name).toBe('Adam');
    });
  });

  describe('getNodeByName', () => {
    it('should find node by name case-insensitively', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      const node = store.getNodeByName('adam');
      expect(node).toBeDefined();
      expect(node!.id).toBe('1');
    });
  });

  describe('loadData', () => {
    it('should bulk load nodes and edges', () => {
      store.loadData({
        nodes: [
          { id: '1', attributes: { name: 'Adam', type: 'person', gender: 'male' } },
          { id: '2', attributes: { name: 'Eve', type: 'person', gender: 'female' } },
        ],
        edges: [
          { id: 'e1', sourceId: '1', targetId: '2', attributes: { type: 'husband_of' } },
        ],
      });
      expect(store.nodeCount).toBe(2);
      expect(store.edgeCount).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all nodes and edges', () => {
      store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
      store.clear();
      expect(store.nodeCount).toBe(0);
      expect(store.edgeCount).toBe(0);
    });
  });
});
