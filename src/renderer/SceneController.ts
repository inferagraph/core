import type {
  LayoutMode,
  NodeRenderConfig,
  TooltipConfig,
  Vector3,
} from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';
import { LayoutEngine } from '../layouts/LayoutEngine.js';
import { ForceLayout3D } from '../layouts/ForceLayout3D.js';
import { TreeLayout } from '../layouts/TreeLayout.js';
import { WebGLRenderer } from './WebGLRenderer.js';
import { CameraController } from './CameraController.js';
import { NodeMesh } from './NodeMesh.js';
import { EdgeMesh } from './EdgeMesh.js';

export interface SceneControllerOptions {
  store: GraphStore;
  layout?: LayoutMode;
  nodeRender?: NodeRenderConfig;
  tooltip?: TooltipConfig;
}

/**
 * Orchestrates the WebGLRenderer, LayoutEngine, CameraController, and
 * GraphStore so the React layer (or any other host) can mount a fully
 * functioning visualization with one call.
 *
 * Lifecycle:
 *   const ctrl = new SceneController({ store });
 *   ctrl.attach(container);
 *   ctrl.syncFromStore();   // build meshes from current store contents
 *   // ...later...
 *   ctrl.setLayout('tree');
 *   ctrl.detach();
 */
export class SceneController {
  private readonly store: GraphStore;
  private readonly renderer = new WebGLRenderer();
  private readonly cameraController = new CameraController();

  private container: HTMLElement | null = null;

  private nodeMesh: NodeMesh | null = null;
  private edgeMesh: EdgeMesh | null = null;

  private layoutMode: LayoutMode;
  private layoutEngine: LayoutEngine;

  private nodeRender: NodeRenderConfig | undefined;
  private tooltip: TooltipConfig | undefined;

  private nodeIdsByIndex: string[] = [];
  private edgeEndpoints: Array<{ sourceId: string; targetId: string }> = [];

  constructor(options: SceneControllerOptions) {
    this.store = options.store;
    this.layoutMode = options.layout ?? 'graph';
    this.layoutEngine = SceneController.createLayoutEngine(this.layoutMode);
    this.nodeRender = options.nodeRender;
    this.tooltip = options.tooltip;
  }

  /** The WebGLRenderer this controller drives. Exposed for advanced consumers. */
  getRenderer(): WebGLRenderer {
    return this.renderer;
  }

  /** The active LayoutEngine. Exposed for tests + advanced consumers. */
  getLayoutEngine(): LayoutEngine {
    return this.layoutEngine;
  }

  /** The currently active layout mode. */
  getLayoutMode(): LayoutMode {
    return this.layoutMode;
  }

  /**
   * Mount the renderer + camera on `container` and start the render loop.
   * Safe to call once; subsequent calls without a prior `detach()` are a no-op.
   */
  attach(container: HTMLElement): void {
    if (this.container) return;
    this.container = container;

    this.renderer.attach(container);

    const camera = this.renderer.getCamera();
    if (camera) {
      this.cameraController.attach(container, camera);
    }

    this.renderer.startRenderLoop();
  }

  /**
   * Stop the render loop and tear everything down. Safe to call repeatedly.
   */
  detach(): void {
    if (!this.container) return;

    this.cameraController.detach();
    this.renderer.detach();

    this.nodeMesh = null;
    this.edgeMesh = null;
    this.nodeIdsByIndex = [];
    this.edgeEndpoints = [];

    this.container = null;
  }

  /**
   * Read all nodes + edges from the store, run the layout, and (re)build
   * the meshes that the WebGLRenderer renders. Idempotent.
   */
  syncFromStore(): void {
    if (!this.container) return;

    // Clear any previous meshes so we can rebuild from scratch.
    if (this.nodeMesh) {
      this.renderer.removeNodeMesh('__nodes__');
      this.nodeMesh = null;
    }
    if (this.edgeMesh) {
      this.renderer.removeEdgeMesh('__edges__');
      this.edgeMesh = null;
    }

    const nodes = this.store.getAllNodes();
    const edges = this.store.getAllEdges();

    this.nodeIdsByIndex = nodes.map((n) => n.id);
    this.edgeEndpoints = edges.map((e) => ({ sourceId: e.sourceId, targetId: e.targetId }));

    if (nodes.length === 0) return;

    // Compute initial positions.
    const positions = this.layoutEngine.compute(this.nodeIdsByIndex, this.edgeEndpoints);

    // Build the (single) instanced node mesh that holds every node.
    const nodeMesh = new NodeMesh(this.nodeRender);
    nodeMesh.createInstancedMesh(nodes.length);
    this.nodeIdsByIndex.forEach((id, index) => {
      const pos = positions.get(id) ?? { x: 0, y: 0, z: 0 };
      nodeMesh.updateInstance(index, pos);
    });
    this.renderer.addNodeMesh('__nodes__', nodeMesh);
    this.nodeMesh = nodeMesh;

    if (edges.length > 0) {
      const edgeMesh = new EdgeMesh();
      edgeMesh.createLineSegments(edges.length);
      this.edgeEndpoints.forEach((endpoints, index) => {
        const source = positions.get(endpoints.sourceId) ?? { x: 0, y: 0, z: 0 };
        const target = positions.get(endpoints.targetId) ?? { x: 0, y: 0, z: 0 };
        edgeMesh.updateSegment(index, source, target);
      });
      this.renderer.addEdgeMesh('__edges__', edgeMesh);
      this.edgeMesh = edgeMesh;
    }

    // For animated layouts, the render loop will tick and reposition.
    // For static layouts (e.g. tree), we've already placed everything.
  }

  /**
   * Switch layout mode at runtime. Re-runs layout and rebuilds positions
   * (but reuses existing meshes when possible).
   */
  setLayout(mode: LayoutMode): void {
    if (mode === this.layoutMode) return;
    this.layoutMode = mode;
    this.layoutEngine = SceneController.createLayoutEngine(mode);

    if (this.nodeIdsByIndex.length === 0) return;

    const positions = this.layoutEngine.compute(this.nodeIdsByIndex, this.edgeEndpoints);
    this.applyPositions(positions);
  }

  /**
   * Replace the NodeRenderConfig at runtime. Triggers a mesh rebuild because
   * node geometry/style is baked into the InstancedMesh on construction.
   */
  setNodeRender(config: NodeRenderConfig | undefined): void {
    this.nodeRender = config;
    if (this.container && this.nodeMesh) {
      this.syncFromStore();
    }
  }

  /**
   * Replace the TooltipConfig at runtime. Stored for future tooltip overlay
   * wiring; no immediate visual effect today.
   */
  setTooltip(config: TooltipConfig | undefined): void {
    this.tooltip = config;
  }

  /** Read-only access to the active node render config (for tests). */
  getNodeRender(): NodeRenderConfig | undefined {
    return this.nodeRender;
  }

  /** Read-only access to the active tooltip config (for tests). */
  getTooltip(): TooltipConfig | undefined {
    return this.tooltip;
  }

  /** Resize the renderer to match the container. */
  resize(): void {
    this.renderer.resize();
  }

  // --- internals ---

  private applyPositions(positions: Map<string, Vector3>): void {
    if (this.nodeMesh) {
      this.nodeIdsByIndex.forEach((id, index) => {
        const pos = positions.get(id) ?? { x: 0, y: 0, z: 0 };
        this.nodeMesh!.updateInstance(index, pos);
      });
    }
    if (this.edgeMesh) {
      this.edgeEndpoints.forEach((endpoints, index) => {
        const source = positions.get(endpoints.sourceId) ?? { x: 0, y: 0, z: 0 };
        const target = positions.get(endpoints.targetId) ?? { x: 0, y: 0, z: 0 };
        this.edgeMesh!.updateSegment(index, source, target);
      });
    }
  }

  private static createLayoutEngine(mode: LayoutMode): LayoutEngine {
    switch (mode) {
      case 'tree':
        return new TreeLayout();
      case 'graph':
      default:
        return new ForceLayout3D();
    }
  }
}
