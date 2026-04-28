import * as THREE from 'three';
import type {
  LayoutMode,
  NodeData,
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
import { LabelRenderer } from './LabelRenderer.js';
import { Raycaster } from './Raycaster.js';
import { TooltipOverlay } from '../overlay/TooltipOverlay.js';
import {
  NodeColorResolver,
  type NodeColorFn,
  type NodeColorResolverOptions,
} from './NodeColorResolver.js';

export interface SceneControllerOptions {
  store: GraphStore;
  layout?: LayoutMode;
  nodeRender?: NodeRenderConfig;
  tooltip?: TooltipConfig;
  /** Custom resolver for per-node colours. */
  nodeColorFn?: NodeColorFn;
  /** Override the resting + hover palettes used by the default resolver. */
  nodeColors?: NodeColorResolverOptions;
  /** Toggle visible labels per node. Default: true. */
  showLabels?: boolean;
  /** Toggle hover tooltip + colour change. Default: true. */
  enableHover?: boolean;
}

/**
 * Orchestrates the WebGLRenderer, LayoutEngine, CameraController, GraphStore,
 * LabelRenderer, Raycaster, and TooltipOverlay so the React layer (or any
 * other host) can mount a fully functioning visualization with one call.
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
  private readonly labelRenderer = new LabelRenderer();
  private readonly raycaster = new Raycaster();
  private readonly tooltipOverlay = new TooltipOverlay();
  private readonly colorResolver: NodeColorResolver;

  private container: HTMLElement | null = null;
  private labelOverlay: HTMLElement | null = null;

  private nodeMesh: NodeMesh | null = null;
  private edgeMesh: EdgeMesh | null = null;

  private layoutMode: LayoutMode;
  private layoutEngine: LayoutEngine;

  private nodeRender: NodeRenderConfig | undefined;
  private tooltip: TooltipConfig | undefined;

  private showLabels: boolean;
  private enableHover: boolean;

  private nodeIdsByIndex: string[] = [];
  private nodesByIndex: NodeData[] = [];
  private edgeEndpoints: Array<{ sourceId: string; targetId: string }> = [];

  private hoveredIndex: number | null = null;
  private pointerX: number = 0;
  private pointerY: number = 0;
  private pointerActive: boolean = false;

  // Bound handlers (so we can remove them).
  private onPointerMoveBound = this.onPointerMove.bind(this);
  private onPointerLeaveBound = this.onPointerLeave.bind(this);
  private tickBound = this.tick.bind(this);

  // Reusable Three.js scratch — avoid GC churn in the hot loop.
  private readonly _projectVec = new THREE.Vector3();

  constructor(options: SceneControllerOptions) {
    this.store = options.store;
    this.layoutMode = options.layout ?? 'graph';
    this.layoutEngine = SceneController.createLayoutEngine(this.layoutMode);
    this.nodeRender = options.nodeRender;
    this.tooltip = options.tooltip;
    this.showLabels = options.showLabels ?? true;
    this.enableHover = options.enableHover ?? true;
    this.colorResolver = new NodeColorResolver({
      ...(options.nodeColors ?? {}),
      colorFn: options.nodeColorFn ?? options.nodeColors?.colorFn,
    });
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

  /** The HTML label renderer (exposed for tests + advanced consumers). */
  getLabelRenderer(): LabelRenderer {
    return this.labelRenderer;
  }

  /** The hover-test raycaster (exposed for tests + advanced consumers). */
  getRaycaster(): Raycaster {
    return this.raycaster;
  }

  /** The tooltip overlay (exposed for tests + advanced consumers). */
  getTooltipOverlay(): TooltipOverlay {
    return this.tooltipOverlay;
  }

  /** The colour resolver (exposed for tests + advanced consumers). */
  getColorResolver(): NodeColorResolver {
    return this.colorResolver;
  }

  /** Index of the currently hovered node, if any. */
  getHoveredIndex(): number | null {
    return this.hoveredIndex;
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
      this.raycaster.setCamera(camera);
    }

    // Label overlay — sits above the WebGL canvas, below tooltip + custom nodes.
    this.labelOverlay = document.createElement('div');
    this.labelOverlay.className = 'ig-label-overlay';
    this.labelOverlay.style.position = 'absolute';
    this.labelOverlay.style.inset = '0';
    this.labelOverlay.style.pointerEvents = 'none';
    this.labelOverlay.style.overflow = 'hidden';
    container.appendChild(this.labelOverlay);
    this.labelRenderer.attach(this.labelOverlay);

    // Tooltip overlay sits on top.
    this.tooltipOverlay.attach(container);
    if (this.tooltip) {
      this.tooltipOverlay.setRenderConfig(this.tooltip);
    }

    // Pointer events for hover + tooltip.
    if (this.enableHover) {
      container.addEventListener('pointermove', this.onPointerMoveBound);
      container.addEventListener('pointerleave', this.onPointerLeaveBound);
    }

    // Per-frame tick: settle physics, project labels, run hover raycast.
    this.renderer.addTickCallback(this.tickBound);

    this.renderer.startRenderLoop();
  }

  /**
   * Stop the render loop and tear everything down. Safe to call repeatedly.
   */
  detach(): void {
    if (!this.container) return;

    if (this.enableHover) {
      this.container.removeEventListener('pointermove', this.onPointerMoveBound);
      this.container.removeEventListener('pointerleave', this.onPointerLeaveBound);
    }

    this.renderer.removeTickCallback(this.tickBound);
    this.cameraController.detach();
    this.labelRenderer.clear();
    this.tooltipOverlay.detach();

    if (this.labelOverlay) {
      this.labelOverlay.remove();
      this.labelOverlay = null;
    }

    this.renderer.detach();

    this.nodeMesh = null;
    this.edgeMesh = null;
    this.nodeIdsByIndex = [];
    this.nodesByIndex = [];
    this.edgeEndpoints = [];
    this.hoveredIndex = null;
    this.pointerActive = false;

    this.container = null;
  }

  /**
   * Read all nodes + edges from the store, run the layout, and (re)build the
   * meshes that the WebGLRenderer renders. Idempotent.
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
    this.labelRenderer.clear();
    this.hoveredIndex = null;

    const nodes = this.store.getAllNodes();
    const edges = this.store.getAllEdges();

    this.nodeIdsByIndex = nodes.map((n) => n.id);
    this.nodesByIndex = nodes.slice();
    this.edgeEndpoints = edges.map((e) => ({ sourceId: e.sourceId, targetId: e.targetId }));

    if (nodes.length === 0) return;

    // Compute initial positions.
    const positions = this.layoutEngine.compute(this.nodeIdsByIndex, this.edgeEndpoints);

    // Build the (single) instanced node mesh that holds every node.
    const nodeMesh = new NodeMesh(this.nodeRender);
    nodeMesh.createInstancedMesh(nodes.length);
    this.nodeIdsByIndex.forEach((id, index) => {
      const pos = positions.get(id) ?? { x: 0, y: 0, z: 0 };
      const node = this.nodesByIndex[index];
      nodeMesh.updateInstance(index, pos, this.colorResolver.resolve(node));
    });
    this.renderer.addNodeMesh('__nodes__', nodeMesh);
    this.nodeMesh = nodeMesh;

    // Sync the label style with the node-render style and (re)build labels.
    this.labelRenderer.setStyle(nodeMesh.nodeStyle);
    if (this.showLabels) {
      this.nodesByIndex.forEach((node) => {
        const text = SceneController.getLabelText(node);
        if (text) this.labelRenderer.addLabel(node.id, text);
      });
    }

    // Wire raycaster targets so hover testing can succeed.
    const threeMesh = nodeMesh.getMesh();
    this.raycaster.setObjects(threeMesh ? [threeMesh] : []);
    this.raycaster.setNodeIds(this.nodeIdsByIndex);
    const cam = this.renderer.getCamera();
    if (cam) this.raycaster.setCamera(cam);

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

    // Frame the camera so the freshly-laid-out graph is visible.
    this.frameToFit(positions);
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
    this.frameToFit(positions);
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
   * Replace the TooltipConfig at runtime. Updates the tooltip overlay's
   * custom render hook so consumers can swap formatting on the fly.
   */
  setTooltip(config: TooltipConfig | undefined): void {
    this.tooltip = config;
    if (config) this.tooltipOverlay.setRenderConfig(config);
  }

  /** Read-only access to the active node render config (for tests). */
  getNodeRender(): NodeRenderConfig | undefined {
    return this.nodeRender;
  }

  /** Read-only access to the active tooltip config (for tests). */
  getTooltip(): TooltipConfig | undefined {
    return this.tooltip;
  }

  /** Toggle visible labels at runtime. */
  setShowLabels(show: boolean): void {
    if (this.showLabels === show) return;
    this.showLabels = show;
    this.labelRenderer.clear();
    if (show) {
      this.nodesByIndex.forEach((node) => {
        const text = SceneController.getLabelText(node);
        if (text) this.labelRenderer.addLabel(node.id, text);
      });
    }
  }

  /** Toggle hover (raycast + tooltip + colour change) at runtime. */
  setEnableHover(enable: boolean): void {
    if (this.enableHover === enable) return;
    this.enableHover = enable;
    if (!this.container) return;

    if (enable) {
      this.container.addEventListener('pointermove', this.onPointerMoveBound);
      this.container.addEventListener('pointerleave', this.onPointerLeaveBound);
    } else {
      this.container.removeEventListener('pointermove', this.onPointerMoveBound);
      this.container.removeEventListener('pointerleave', this.onPointerLeaveBound);
      this.clearHover();
    }
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
        const node = this.nodesByIndex[index];
        const isHover = this.hoveredIndex === index;
        const color = isHover
          ? this.colorResolver.resolveHover(node)
          : this.colorResolver.resolve(node);
        this.nodeMesh!.updateInstance(index, pos, color);
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

  /**
   * Per-frame tick: advance the layout simulation (force-directed only),
   * push positions to the meshes, project labels into screen space, and
   * (if hover is enabled) run the raycast to update the hovered node.
   */
  private tick(): void {
    if (!this.container) return;

    // Drive animated layouts.
    if (this.layoutEngine.animated && this.nodeIdsByIndex.length > 0) {
      this.layoutEngine.tick();
      const positions = this.layoutEngine.getPositions();
      this.applyPositions(positions);
    }

    // Project labels.
    if (this.showLabels) this.projectLabels();

    // Update hover state if pointer is over the canvas.
    if (this.enableHover && this.pointerActive) this.updateHover();
  }

  private projectLabels(): void {
    if (!this.container || !this.nodeMesh) return;
    const camera = this.renderer.getCamera();
    if (!camera) return;

    const positions = this.layoutEngine.getPositions();
    if (positions.size === 0) return;

    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    const halfW = width / 2;
    const halfH = height / 2;

    for (let i = 0; i < this.nodeIdsByIndex.length; i++) {
      const id = this.nodeIdsByIndex[i];
      const pos = positions.get(id);
      if (!pos) continue;

      this._projectVec.set(pos.x, pos.y, pos.z);
      this._projectVec.project(camera);

      // If z > 1, the point is behind the camera — hide its label.
      const x = this._projectVec.x * halfW + halfW;
      const y = -this._projectVec.y * halfH + halfH;
      this.labelRenderer.updatePosition(id, x, y);
    }
  }

  private onPointerMove(event: Event): void {
    if (!this.container) return;
    // PointerEvent extends MouseEvent; we only care about client coords.
    const me = event as MouseEvent;
    const rect = this.container.getBoundingClientRect();
    this.pointerX = me.clientX - rect.left;
    this.pointerY = me.clientY - rect.top;
    this.pointerActive = true;
    // Hover update happens in the next tick — keeps raycasting in sync with
    // the latest projection matrix.
  }

  private onPointerLeave(): void {
    this.pointerActive = false;
    this.clearHover();
  }

  private updateHover(): void {
    if (!this.container || !this.nodeMesh) return;

    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    const id = this.raycaster.hitTest(this.pointerX, this.pointerY, width, height);

    if (id === null) {
      this.clearHover();
      return;
    }

    const newIndex = this.nodeIdsByIndex.indexOf(id);
    if (newIndex < 0) {
      this.clearHover();
      return;
    }

    if (this.hoveredIndex === newIndex) {
      // Same node — just keep the tooltip following the pointer.
      this.showTooltip(this.nodesByIndex[newIndex]);
      return;
    }

    // Revert previously-hovered node.
    if (this.hoveredIndex !== null) {
      this.paintNode(this.hoveredIndex, /* hovered */ false);
    }
    this.hoveredIndex = newIndex;
    this.paintNode(newIndex, /* hovered */ true);
    this.showTooltip(this.nodesByIndex[newIndex]);
  }

  private clearHover(): void {
    if (this.hoveredIndex !== null) {
      this.paintNode(this.hoveredIndex, /* hovered */ false);
      this.hoveredIndex = null;
    }
    this.tooltipOverlay.hide();
  }

  private paintNode(index: number, hovered: boolean): void {
    if (!this.nodeMesh) return;
    const node = this.nodesByIndex[index];
    if (!node) return;

    const positions = this.layoutEngine.getPositions();
    const id = this.nodeIdsByIndex[index];
    const pos = positions.get(id) ?? { x: 0, y: 0, z: 0 };

    const color = hovered
      ? this.colorResolver.resolveHover(node)
      : this.colorResolver.resolve(node);
    // updateInstance writes both matrix + colour; keep matrix unchanged by
    // re-using the current position.
    this.nodeMesh.updateInstance(index, pos, color);
  }

  private showTooltip(node: NodeData): void {
    // Offset slightly so the tooltip doesn't sit under the cursor.
    this.tooltipOverlay.showNode(node, this.pointerX + 12, this.pointerY + 12);
  }

  /**
   * Push the camera back so the entire graph is visible. Best-effort —
   * computes the bounding sphere of the laid-out positions and sets the
   * orbit radius accordingly.
   */
  private frameToFit(positions: Map<string, Vector3>): void {
    if (positions.size === 0) return;

    let cx = 0, cy = 0, cz = 0;
    for (const p of positions.values()) {
      cx += p.x;
      cy += p.y;
      cz += p.z;
    }
    cx /= positions.size;
    cy /= positions.size;
    cz /= positions.size;

    let maxDistSq = 0;
    for (const p of positions.values()) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dz = p.z - cz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > maxDistSq) maxDistSq = d;
    }
    const radius = Math.max(50, Math.sqrt(maxDistSq) * 2.5);

    this.cameraController.setTarget({ x: cx, y: cy, z: cz });
    this.cameraController.setRadius(radius);
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

  private static getLabelText(node: NodeData): string | null {
    const attrs = node.attributes ?? {};
    const candidates = [attrs.title, attrs.name, attrs.label];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
    }
    return node.id;
  }
}
