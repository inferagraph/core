import type { Vector3, NodeId } from '../types.js';
import { BarnesHut } from './BarnesHut.js';
import { CoulombForce } from './forces/CoulombForce.js';
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
  private readonly coulomb = new CoulombForce();
  private readonly spring = new SpringForce();
  private readonly centering = new CenteringForce();
  private readonly damping = new DampingForce();
  private running = false;

  setNodes(nodeIds: NodeId[]): void {
    this.nodes = nodeIds.map((id) => ({
      id,
      position: {
        x: (Math.random() - 0.5) * 200,
        y: (Math.random() - 0.5) * 200,
        z: (Math.random() - 0.5) * 200,
      },
      velocity: { x: 0, y: 0, z: 0 },
    }));
  }

  setEdges(edges: Array<{ sourceId: NodeId; targetId: NodeId }>): void {
    const nodeIndex = new Map<NodeId, number>();
    this.nodes.forEach((n, i) => nodeIndex.set(n.id, i));

    this.edges = edges
      .map((e) => ({
        sourceIndex: nodeIndex.get(e.sourceId) ?? -1,
        targetIndex: nodeIndex.get(e.targetId) ?? -1,
      }))
      .filter((e) => e.sourceIndex >= 0 && e.targetIndex >= 0);
  }

  tick(): void {
    const positions = this.nodes.map((n) => n.position);
    const masses = this.nodes.map(() => 1);
    const tree = this.barnesHut.buildTree(positions, masses);

    for (let i = 0; i < this.nodes.length; i++) {
      const repulsion = this.barnesHut.computeForce(tree, positions[i], 100);
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
