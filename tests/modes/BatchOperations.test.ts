import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { SelectionManager } from '../../src/modes/SelectionManager.js';
import { BatchOperations } from '../../src/modes/BatchOperations.js';

describe('BatchOperations', () => {
  let store: GraphStore;
  let queryEngine: QueryEngine;
  let selection: SelectionManager;
  let batch: BatchOperations;

  beforeEach(() => {
    store = new GraphStore();
    queryEngine = new QueryEngine(store);
    selection = new SelectionManager();
    batch = new BatchOperations(store, queryEngine, selection);

    store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
    store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
    store.addNode('3', { name: 'Cain', type: 'person', gender: 'male' });
    store.addNode('4', { name: 'Abel', type: 'person', gender: 'male' });
    store.addEdge('e1', '1', '2', { type: 'husband_of' });
    store.addEdge('e2', '1', '3', { type: 'father_of' });
    store.addEdge('e3', '1', '4', { type: 'father_of' });
    store.addEdge('e4', '3', '4', { type: 'brother_of' });
  });

  describe('deleteSelected', () => {
    it('should remove selected nodes from the store', () => {
      selection.selectMany(['3', '4']);
      batch.deleteSelected();
      expect(store.hasNode('3')).toBe(false);
      expect(store.hasNode('4')).toBe(false);
      expect(store.hasNode('1')).toBe(true);
      expect(store.hasNode('2')).toBe(true);
    });

    it('should clear selection after delete', () => {
      selection.selectMany(['3', '4']);
      batch.deleteSelected();
      expect(selection.count).toBe(0);
    });

    it('should return count of deleted nodes', () => {
      selection.selectMany(['3', '4']);
      const count = batch.deleteSelected();
      expect(count).toBe(2);
    });

    it('should return 0 when selection is empty', () => {
      const count = batch.deleteSelected();
      expect(count).toBe(0);
    });

    it('should remove edges connected to deleted nodes', () => {
      selection.selectMany(['3']);
      batch.deleteSelected();
      // e2 (1->3) and e4 (3->4) should be removed
      expect(store.edgeCount).toBe(2); // e1 (1->2) and e3 (1->4) remain
    });
  });

  describe('getSelectedSubgraph', () => {
    it('should return subgraph with nodes and edges for selection', () => {
      selection.selectMany(['1', '2']);
      const subgraph = batch.getSelectedSubgraph();
      expect(subgraph.nodeIds).toContain('1');
      expect(subgraph.nodeIds).toContain('2');
      expect(subgraph.edgeIds).toContain('e1');
      // Should not include edges to nodes outside selection
      expect(subgraph.edgeIds).not.toContain('e2');
    });

    it('should return empty subgraph when nothing is selected', () => {
      const subgraph = batch.getSelectedSubgraph();
      expect(subgraph.nodeIds).toHaveLength(0);
      expect(subgraph.edgeIds).toHaveLength(0);
    });
  });

  describe('hasSelection', () => {
    it('should return true when nodes are selected', () => {
      selection.select('1');
      expect(batch.hasSelection()).toBe(true);
    });

    it('should return false when selection is empty', () => {
      expect(batch.hasSelection()).toBe(false);
    });
  });

  describe('selectAllNodes', () => {
    it('should select all provided node IDs', () => {
      const allIds = ['1', '2', '3', '4'];
      batch.selectAllNodes(allIds);
      expect(selection.count).toBe(4);
      for (const id of allIds) {
        expect(selection.isSelected(id)).toBe(true);
      }
    });

    it('should replace previous selection', () => {
      selection.select('1');
      batch.selectAllNodes(['2', '3']);
      expect(selection.isSelected('1')).toBe(false);
      expect(selection.isSelected('2')).toBe(true);
      expect(selection.isSelected('3')).toBe(true);
      expect(selection.count).toBe(2);
    });
  });

  describe('getSelectedIds', () => {
    it('should return array of selected IDs', () => {
      selection.selectMany(['1', '3']);
      const ids = batch.getSelectedIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('1');
      expect(ids).toContain('3');
    });

    it('should return empty array when nothing is selected', () => {
      const ids = batch.getSelectedIds();
      expect(ids).toHaveLength(0);
    });
  });
});
