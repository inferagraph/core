import type { NodeId, Vector3, LayoutOptions } from '../types.js';
import { LayoutEngine, type LayoutEdgeInput } from './LayoutEngine.js';
import { ForceSimulation } from '../physics/ForceSimulation.js';
import { debugLog } from '../utils/debugLog.js';

export class ForceLayout3D extends LayoutEngine {
  readonly name = 'force-3d';
  private readonly simulation = new ForceSimulation();
  private computed = false;
  // IG_DEBUG-gated diagnostic
  public __debugId: string = 'fl3d-' + Math.random().toString(36).slice(2, 7);
  private __tickCounter: number = 0;

  constructor(options?: LayoutOptions) {
    super({ animated: true, ...options });
    try {
      debugLog(`[ig-pos:engine-ctor] kind=ForceLayout3D id=${this.__debugId}`);
    } catch {}
  }

  compute(
    nodeIds: NodeId[],
    edges: Array<LayoutEdgeInput>,
  ): Map<NodeId, Vector3> {
    try {
      debugLog(
        `[ig-pos:engineOp] op=compute kind=ForceLayout3D id=${this.__debugId} nodeCount=${nodeIds.length} edgeCount=${edges.length} prevComputed=${this.computed}`,
      );
    } catch {}
    this.simulation.setNodes(nodeIds);
    // Force layout doesn't care about edge types — strip the optional `type`
    // before handing the edge list to the physics simulation.
    this.simulation.setEdges(
      edges.map((e) => ({ sourceId: e.sourceId, targetId: e.targetId })),
    );

    // 250 settle ticks: with the 0.1.11 force tuning (softer spring, larger
    // rest length, stronger repulsion, gentle centering) the simulation
    // takes ~150 ticks to reach a near-stable equilibrium for ~20-node
    // graphs. 250 leaves headroom so the user sees a settled cluster on
    // first paint instead of mid-flight oscillation.
    for (let i = 0; i < 250; i++) {
      this.simulation.tick();
    }

    this.computed = true;
    return this.simulation.getPositions();
  }

  tick(): void {
    if (this.animated && this.computed) {
      this.simulation.tick();
      // IG_DEBUG-gated diagnostic: sample positions at exponential tick marks
      this.__tickCounter++;
      if (
        this.__tickCounter === 1 ||
        this.__tickCounter === 10 ||
        this.__tickCounter === 50 ||
        this.__tickCounter === 100
      ) {
        try {
          const positions = this.simulation.getPositions();
          const sample: Array<{ id: string; x: number; y: number; z: number }> = [];
          let i = 0;
          for (const [id, p] of positions) {
            if (i >= 3) break;
            sample.push({
              id,
              x: Number(p.x.toFixed(2)),
              y: Number(p.y.toFixed(2)),
              z: Number(p.z.toFixed(2)),
            });
            i++;
          }
          debugLog(
            `[ig-pos:tick:after-N] N=${this.__tickCounter} kind=ForceLayout3D id=${this.__debugId} sample=${JSON.stringify(sample)}`,
          );
        } catch {}
      }
    }
  }

  // IG_DEBUG-gated diagnostic
  resetTickCounter(): void {
    this.__tickCounter = 0;
  }

  getPositions(): Map<NodeId, Vector3> {
    return this.simulation.getPositions();
  }

  /**
   * Force-directed layouts have no canonical center — the cluster
   * wanders during simulation, and the percentile-midpoint heuristic
   * inside `frameToFit` produces a sensible camera target in graph
   * mode. Return `null` to opt out of the origin-based fast path.
   */
  getOrigin(): null {
    return null;
  }
}
