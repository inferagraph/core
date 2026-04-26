import type { NodeId, Vector3, LayoutOptions } from '../types.js';
import { LayoutEngine } from './LayoutEngine.js';
import { ForceSimulation } from '../physics/ForceSimulation.js';

export class ForceLayout3D extends LayoutEngine {
  readonly name = 'force-3d';
  private readonly simulation = new ForceSimulation();
  private computed = false;

  constructor(options?: LayoutOptions) {
    super({ animated: true, ...options });
  }

  compute(
    nodeIds: NodeId[],
    edges: Array<{ sourceId: NodeId; targetId: NodeId }>,
  ): Map<NodeId, Vector3> {
    this.simulation.setNodes(nodeIds);
    this.simulation.setEdges(edges);

    for (let i = 0; i < 100; i++) {
      this.simulation.tick();
    }

    this.computed = true;
    return this.simulation.getPositions();
  }

  tick(): void {
    if (this.animated && this.computed) {
      this.simulation.tick();
    }
  }

  getPositions(): Map<NodeId, Vector3> {
    return this.simulation.getPositions();
  }
}
