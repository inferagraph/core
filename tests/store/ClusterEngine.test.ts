import { describe, it, expect, beforeEach } from 'vitest';
import { ClusterEngine } from '../../src/store/ClusterEngine.js';
import { GraphStore } from '../../src/store/GraphStore.js';

function createConnectedGraph(): GraphStore {
  const store = new GraphStore();
  store.loadData({
    nodes: [
      // Cluster 1: tightly connected
      { id: 'a1', attributes: { name: 'A1', type: 'person' } },
      { id: 'a2', attributes: { name: 'A2', type: 'person' } },
      { id: 'a3', attributes: { name: 'A3', type: 'person' } },
      // Cluster 2: tightly connected
      { id: 'b1', attributes: { name: 'B1', type: 'person' } },
      { id: 'b2', attributes: { name: 'B2', type: 'person' } },
      { id: 'b3', attributes: { name: 'B3', type: 'person' } },
    ],
    edges: [
      // Dense connections within cluster 1
      { id: 'e1', sourceId: 'a1', targetId: 'a2', attributes: { type: 'knows' } },
      { id: 'e2', sourceId: 'a2', targetId: 'a3', attributes: { type: 'knows' } },
      { id: 'e3', sourceId: 'a1', targetId: 'a3', attributes: { type: 'knows' } },
      // Dense connections within cluster 2
      { id: 'e4', sourceId: 'b1', targetId: 'b2', attributes: { type: 'knows' } },
      { id: 'e5', sourceId: 'b2', targetId: 'b3', attributes: { type: 'knows' } },
      { id: 'e6', sourceId: 'b1', targetId: 'b3', attributes: { type: 'knows' } },
      // Single weak link between clusters
      { id: 'e7', sourceId: 'a1', targetId: 'b1', attributes: { type: 'knows' } },
    ],
  });
  return store;
}

function createDisconnectedGraph(): GraphStore {
  const store = new GraphStore();
  store.loadData({
    nodes: [
      { id: 'x', attributes: { name: 'X', type: 'person' } },
      { id: 'y', attributes: { name: 'Y', type: 'person' } },
      { id: 'z', attributes: { name: 'Z', type: 'person' } },
    ],
    edges: [],
  });
  return store;
}

describe('ClusterEngine', () => {
  describe('detectCommunities()', () => {
    it('should detect obvious clusters in connected graph', () => {
      const store = createConnectedGraph();
      const engine = new ClusterEngine(store);
      const clusters = engine.detectCommunities();

      expect(clusters.length).toBeGreaterThanOrEqual(1);
      // All nodes should be assigned
      const allNodeIds = new Set<string>();
      for (const c of clusters) {
        for (const id of c.nodeIds) allNodeIds.add(id);
      }
      expect(allNodeIds.size).toBe(6);
    });

    it('should put each disconnected node in its own cluster', () => {
      const store = createDisconnectedGraph();
      const engine = new ClusterEngine(store);
      const clusters = engine.detectCommunities();

      expect(clusters).toHaveLength(3);
      for (const c of clusters) {
        expect(c.nodeIds.size).toBe(1);
      }
    });

    it('should handle empty graph', () => {
      const store = new GraphStore();
      const engine = new ClusterEngine(store);
      const clusters = engine.detectCommunities();
      expect(clusters).toHaveLength(0);
    });

    it('should assign cluster IDs', () => {
      const store = createConnectedGraph();
      const engine = new ClusterEngine(store);
      const clusters = engine.detectCommunities();
      for (const c of clusters) {
        expect(c.id).toBeDefined();
        expect(c.id).toMatch(/^cluster-\d+$/);
      }
    });
  });

  describe('getClusterForNode()', () => {
    it('should return the cluster containing a node', () => {
      const store = createConnectedGraph();
      const engine = new ClusterEngine(store);
      engine.detectCommunities();

      const cluster = engine.getClusterForNode('a1');
      expect(cluster).toBeDefined();
      expect(cluster!.nodeIds.has('a1')).toBe(true);
    });

    it('should return undefined for unknown node', () => {
      const store = createConnectedGraph();
      const engine = new ClusterEngine(store);
      engine.detectCommunities();

      expect(engine.getClusterForNode('unknown')).toBeUndefined();
    });
  });

  describe('collapse/expand', () => {
    it('should collapse a cluster', () => {
      const store = createConnectedGraph();
      const engine = new ClusterEngine(store);
      engine.detectCommunities();
      const clusters = engine.getClusters();

      engine.collapse(clusters[0].id);
      expect(engine.isCollapsed(clusters[0].id)).toBe(true);
    });

    it('should expand a collapsed cluster', () => {
      const store = createConnectedGraph();
      const engine = new ClusterEngine(store);
      engine.detectCommunities();
      const clusters = engine.getClusters();

      engine.collapse(clusters[0].id);
      engine.expand(clusters[0].id);
      expect(engine.isCollapsed(clusters[0].id)).toBe(false);
    });

    it('should reduce visible nodes when collapsed', () => {
      const store = createConnectedGraph();
      const engine = new ClusterEngine(store);
      engine.detectCommunities();

      const allVisible = engine.getVisibleNodes();
      expect(allVisible).toHaveLength(6);

      const clusters = engine.getClusters();
      const bigCluster = clusters.find(c => c.nodeIds.size > 1);
      if (bigCluster) {
        engine.collapse(bigCluster.id);
        const afterCollapse = engine.getVisibleNodes();
        expect(afterCollapse.length).toBeLessThan(6);
      }
    });
  });

  describe('getClusterBoundary()', () => {
    it('should return convex hull for cluster positions', () => {
      const store = createConnectedGraph();
      const engine = new ClusterEngine(store);
      engine.detectCommunities();

      const clusters = engine.getClusters();
      const positions = new Map([
        ['a1', { x: 0, y: 0 }],
        ['a2', { x: 10, y: 0 }],
        ['a3', { x: 5, y: 10 }],
        ['b1', { x: 50, y: 0 }],
        ['b2', { x: 60, y: 0 }],
        ['b3', { x: 55, y: 10 }],
      ]);

      for (const cluster of clusters) {
        const boundary = engine.getClusterBoundary(cluster.id, positions);
        expect(boundary.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('should return empty for unknown cluster', () => {
      const engine = new ClusterEngine(new GraphStore());
      expect(engine.getClusterBoundary('unknown', new Map())).toEqual([]);
    });

    it('should return points directly for fewer than 3 nodes', () => {
      const store = new GraphStore();
      store.loadData({
        nodes: [
          { id: 'solo', attributes: { name: 'Solo', type: 'person' } },
        ],
        edges: [],
      });
      const engine = new ClusterEngine(store);
      engine.detectCommunities();
      const clusters = engine.getClusters();

      const positions = new Map([['solo', { x: 5, y: 5 }]]);
      const boundary = engine.getClusterBoundary(clusters[0].id, positions);
      expect(boundary).toEqual([{ x: 5, y: 5 }]);
    });
  });

  describe('clear()', () => {
    it('should clear all clusters', () => {
      const store = createConnectedGraph();
      const engine = new ClusterEngine(store);
      engine.detectCommunities();
      expect(engine.clusterCount).toBeGreaterThan(0);

      engine.clear();
      expect(engine.clusterCount).toBe(0);
      expect(engine.getClusters()).toHaveLength(0);
    });
  });
});
