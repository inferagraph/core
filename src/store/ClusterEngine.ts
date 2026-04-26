import type { NodeId } from '../types.js';
import { GraphStore } from './GraphStore.js';

export interface Cluster {
  id: string;
  nodeIds: Set<NodeId>;
  label?: string;
}

export class ClusterEngine {
  private clusters = new Map<string, Cluster>();
  private nodeToCluster = new Map<NodeId, string>();
  private collapsed = new Set<string>();

  constructor(private readonly store: GraphStore) {}

  /**
   * Run Louvain-inspired community detection.
   * Assigns each node to a community based on edge density / modularity optimization.
   */
  detectCommunities(): Cluster[] {
    this.clusters.clear();
    this.nodeToCluster.clear();

    // Get all nodes and edges
    const allNodes = this.getAllNodeIds();
    if (allNodes.length === 0) return [];

    // Build adjacency list and edge weights
    const adj = new Map<NodeId, Map<NodeId, number>>();
    let totalWeight = 0;

    for (const nodeId of allNodes) {
      if (!adj.has(nodeId)) adj.set(nodeId, new Map());
      const edges = this.store.getEdgesForNode(nodeId);
      for (const edge of edges) {
        const neighbor = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
        if (!adj.has(neighbor)) adj.set(neighbor, new Map());

        const weight = 1;
        adj.get(nodeId)!.set(neighbor, (adj.get(nodeId)!.get(neighbor) ?? 0) + weight);
        adj.get(neighbor)!.set(nodeId, (adj.get(neighbor)!.get(nodeId) ?? 0) + weight);
        totalWeight += weight;
      }
    }

    if (totalWeight === 0) {
      // No edges — each node is its own cluster
      let i = 0;
      for (const nodeId of allNodes) {
        const clusterId = `cluster-${i++}`;
        this.clusters.set(clusterId, { id: clusterId, nodeIds: new Set([nodeId]) });
        this.nodeToCluster.set(nodeId, clusterId);
      }
      return this.getClusters();
    }

    // Each edge counted twice in undirected, so total = totalWeight / 2 for modularity
    // but we'll use the standard formula
    const m2 = totalWeight; // sum of all weights (each edge counted from both sides)

    // Initialize: each node in its own community
    const community = new Map<NodeId, string>();
    let nextId = 0;
    for (const nodeId of allNodes) {
      community.set(nodeId, `c${nextId++}`);
    }

    // Node degree (sum of edge weights)
    const degree = new Map<NodeId, number>();
    for (const nodeId of allNodes) {
      let deg = 0;
      const neighbors = adj.get(nodeId);
      if (neighbors) {
        for (const w of neighbors.values()) deg += w;
      }
      degree.set(nodeId, deg);
    }

    // Iterative modularity optimization (simplified Louvain phase 1)
    let improved = true;
    let iterations = 0;
    const maxIterations = 20;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      for (const nodeId of allNodes) {
        const currentCommunity = community.get(nodeId)!;
        const ki = degree.get(nodeId) ?? 0;
        const neighbors = adj.get(nodeId) ?? new Map();

        // Calculate weights to each neighboring community
        const communityWeights = new Map<string, number>();
        for (const [neighbor, weight] of neighbors) {
          const neighborComm = community.get(neighbor)!;
          communityWeights.set(neighborComm, (communityWeights.get(neighborComm) ?? 0) + weight);
        }

        // Calculate sum of weights in each community
        const commTotals = new Map<string, number>();
        for (const [nId, comm] of community) {
          commTotals.set(comm, (commTotals.get(comm) ?? 0) + (degree.get(nId) ?? 0));
        }

        // Find best community
        let bestCommunity = currentCommunity;
        let bestDelta = 0;

        // Weight to current community
        const wCurrent = communityWeights.get(currentCommunity) ?? 0;
        const sigmaCurrent = (commTotals.get(currentCommunity) ?? 0) - ki;

        for (const [comm, wComm] of communityWeights) {
          if (comm === currentCommunity) continue;
          const sigmaComm = commTotals.get(comm) ?? 0;

          // Modularity gain: [w_to_new/m - sigma_new*ki/m^2] - [w_to_current/m - sigma_current*ki/m^2]
          const deltaQ = (wComm - wCurrent) / m2 - ki * (sigmaComm - sigmaCurrent) / (m2 * m2);

          if (deltaQ > bestDelta) {
            bestDelta = deltaQ;
            bestCommunity = comm;
          }
        }

        if (bestCommunity !== currentCommunity) {
          community.set(nodeId, bestCommunity);
          improved = true;
        }
      }
    }

    // Build clusters from community assignments
    const communityNodes = new Map<string, Set<NodeId>>();
    for (const [nodeId, comm] of community) {
      if (!communityNodes.has(comm)) communityNodes.set(comm, new Set());
      communityNodes.get(comm)!.add(nodeId);
    }

    let clusterIdx = 0;
    for (const [, nodes] of communityNodes) {
      const clusterId = `cluster-${clusterIdx++}`;
      this.clusters.set(clusterId, { id: clusterId, nodeIds: new Set(nodes) });
      for (const nodeId of nodes) {
        this.nodeToCluster.set(nodeId, clusterId);
      }
    }

    return this.getClusters();
  }

  /** Get all detected clusters */
  getClusters(): Cluster[] {
    return Array.from(this.clusters.values());
  }

  /** Get cluster for a specific node */
  getClusterForNode(nodeId: NodeId): Cluster | undefined {
    const clusterId = this.nodeToCluster.get(nodeId);
    return clusterId ? this.clusters.get(clusterId) : undefined;
  }

  /** Get a cluster by ID */
  getCluster(clusterId: string): Cluster | undefined {
    return this.clusters.get(clusterId);
  }

  /** Collapse a cluster (mark as collapsed) */
  collapse(clusterId: string): void {
    if (this.clusters.has(clusterId)) {
      this.collapsed.add(clusterId);
    }
  }

  /** Expand a cluster (mark as expanded) */
  expand(clusterId: string): void {
    this.collapsed.delete(clusterId);
  }

  /** Check if a cluster is collapsed */
  isCollapsed(clusterId: string): boolean {
    return this.collapsed.has(clusterId);
  }

  /** Get visible node IDs (collapsed clusters → single representative, expanded → all nodes) */
  getVisibleNodes(): NodeId[] {
    const visible: NodeId[] = [];

    for (const [clusterId, cluster] of this.clusters) {
      if (this.collapsed.has(clusterId)) {
        // Collapsed: show only first node as representative
        const nodes = Array.from(cluster.nodeIds);
        visible.push(nodes[0]);
      } else {
        // Expanded: show all
        for (const nodeId of cluster.nodeIds) {
          visible.push(nodeId);
        }
      }
    }

    return visible;
  }

  /** Compute convex hull points for a cluster given node positions */
  getClusterBoundary(clusterId: string, positions: Map<NodeId, { x: number; y: number }>): { x: number; y: number }[] {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return [];

    const points: { x: number; y: number }[] = [];
    for (const nodeId of cluster.nodeIds) {
      const pos = positions.get(nodeId);
      if (pos) points.push(pos);
    }

    if (points.length < 3) return points;

    return this.convexHull(points);
  }

  /** Clear all clusters */
  clear(): void {
    this.clusters.clear();
    this.nodeToCluster.clear();
    this.collapsed.clear();
  }

  /** Get number of clusters */
  get clusterCount(): number {
    return this.clusters.size;
  }

  private getAllNodeIds(): NodeId[] {
    return this.store.getAllNodes().map(n => n.id);
  }

  /** Graham scan convex hull */
  private convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
    if (points.length < 3) return [...points];

    // Find lowest point (and leftmost if tie)
    let lowest = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].y < points[lowest].y ||
          (points[i].y === points[lowest].y && points[i].x < points[lowest].x)) {
        lowest = i;
      }
    }
    [points[0], points[lowest]] = [points[lowest], points[0]];
    const pivot = points[0];

    // Sort by polar angle
    const sorted = points.slice(1).sort((a, b) => {
      const angleA = Math.atan2(a.y - pivot.y, a.x - pivot.x);
      const angleB = Math.atan2(b.y - pivot.y, b.x - pivot.x);
      if (angleA !== angleB) return angleA - angleB;
      // If same angle, closer point first
      const distA = (a.x - pivot.x) ** 2 + (a.y - pivot.y) ** 2;
      const distB = (b.x - pivot.x) ** 2 + (b.y - pivot.y) ** 2;
      return distA - distB;
    });

    const hull = [pivot, sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      while (hull.length > 1) {
        const a = hull[hull.length - 2];
        const b = hull[hull.length - 1];
        const c = sorted[i];
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (cross <= 0) hull.pop();
        else break;
      }
      hull.push(sorted[i]);
    }

    return hull;
  }
}
