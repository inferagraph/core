import type { Vector3, NodeId } from '../types.js';
import { BarnesHut } from './BarnesHut.js';
import { SpringForce } from './forces/SpringForce.js';
import { CenteringForce } from './forces/CenteringForce.js';
import { DampingForce } from './forces/DampingForce.js';

interface SimulationNode {
  id: NodeId;
  position: Vector3;
  velocity: Vector3;
}

interface SimulationEdge {
  sourceIndex: number;
  targetIndex: number;
}

export class ForceSimulation {
  private nodes: SimulationNode[] = [];
  private edges: SimulationEdge[] = [];
  private readonly barnesHut = new BarnesHut();
  private readonly spring = new SpringForce();
  private readonly centering = new CenteringForce();
  private readonly damping = new DampingForce();
  private running = false;

  setNodes(nodeIds: NodeId[]): void {
    // Spread initial positions across a 400-unit cube. The previous 200-unit
    // spread combined with 0.1.10's tight spring rest length crushed even
    // small graphs into a single pile during the first dozen ticks.
    this.nodes = nodeIds.map((id) => ({
      id,
      position: {
        x: (Math.random() - 0.5) * 400,
        y: (Math.random() - 0.5) * 400,
        z: (Math.random() - 0.5) * 400,
      },
      velocity: { x: 0, y: 0, z: 0 },
    }));
  }

  setEdges(edges: Array<{ sourceId: NodeId; targetId: NodeId }>): void {
    const nodeIndex = new Map<NodeId, number>();
    this.nodes.forEach((n, i) => nodeIndex.set(n.id, i));

    // Real-world graphs frequently encode relationships as TWO directional
    // edges (e.g. `father_of` and `son_of` between the same pair). Treating
    // both as independent springs doubles the attractive force on the pair
    // and crushes the cluster. Dedupe by unordered (min, max) index pair so
    // the simulation sees one spring per connected pair regardless of how
    // many directional edges the host stored.
    const seen = new Set<string>();
    const deduped: SimulationEdge[] = [];
    for (const e of edges) {
      const s = nodeIndex.get(e.sourceId) ?? -1;
      const t = nodeIndex.get(e.targetId) ?? -1;
      if (s < 0 || t < 0 || s === t) continue;
      const key = s < t ? `${s}-${t}` : `${t}-${s}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({ sourceIndex: s, targetIndex: t });
    }
    this.edges = deduped;
  }

  tick(): void {
    const positions = this.nodes.map((n) => n.position);
    const masses = this.nodes.map(() => 1);
    const tree = this.barnesHut.buildTree(positions, masses);

    // Repulsion strength bumped from 100 → 800. With the larger spring rest
    // length (80) and softer spring (0.05), the previous 100-strength
    // repulsion couldn't keep nodes from collapsing into a single pile —
    // every pair-wise spring was outweighing the inverse-square repulsion.
    // 800 lets nodes maintain a comfortable 60–120u personal-space radius
    // while still letting connected springs win at long range.
    const REPULSION = 800;

    for (let i = 0; i < this.nodes.length; i++) {
      const repulsion = this.barnesHut.computeForce(tree, positions[i], REPULSION);
      const centering = this.centering.compute(positions[i]);

      this.nodes[i].velocity.x += repulsion.x + centering.x;
      this.nodes[i].velocity.y += repulsion.y + centering.y;
      this.nodes[i].velocity.z += repulsion.z + centering.z;
    }

    for (const edge of this.edges) {
      const attraction = this.spring.compute(
        this.nodes[edge.sourceIndex].position,
        this.nodes[edge.targetIndex].position,
      );
      this.nodes[edge.sourceIndex].velocity.x += attraction.x;
      this.nodes[edge.sourceIndex].velocity.y += attraction.y;
      this.nodes[edge.sourceIndex].velocity.z += attraction.z;
      this.nodes[edge.targetIndex].velocity.x -= attraction.x;
      this.nodes[edge.targetIndex].velocity.y -= attraction.y;
      this.nodes[edge.targetIndex].velocity.z -= attraction.z;
    }

    for (const node of this.nodes) {
      node.velocity = this.damping.apply(node.velocity);
      node.position.x += node.velocity.x;
      node.position.y += node.velocity.y;
      node.position.z += node.velocity.z;
    }
  }

  getPositions(): Map<NodeId, Vector3> {
    const map = new Map<NodeId, Vector3>();
    for (const node of this.nodes) {
      map.set(node.id, { ...node.position });
    }
    return map;
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }
}
