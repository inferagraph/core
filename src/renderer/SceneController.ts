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
import {
  EdgeColorMap,
  type EdgeColorFn,
} from './EdgeColorMap.js';
import { PulseController, type PulseOption } from './PulseController.js';
import { describeNode } from '../utils/describeNode.js';
import type { EdgeLabelMap } from '../utils/aggregateEdges.js';

/**
 * Minimal HTML escape used to safely embed dynamic strings (node titles,
 * relationship phrases) inside the rich-text tooltip body.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SceneControllerOptions {
  store: GraphStore;
  layout?: LayoutMode;
  nodeRender?: NodeRenderConfig;
  tooltip?: TooltipConfig;
  /**
   * Custom resolver for per-node colours. Wins over `nodeColors` /
   * auto-assignment. Domain-specific logic lives here.
   */
  nodeColorFn?: NodeColorFn;
  /** Explicit type→color map for nodes. */
  nodeColors?: Record<string, string>;
  /**
   * Legacy / advanced form: full {@link NodeColorResolverOptions} bag. The
   * shorter-form fields above are merged on top of this. Retained for
   * back-compat with consumers that build resolver options programmatically.
   */
  nodeColorOptions?: NodeColorResolverOptions;
  /** Custom resolver for per-edge colours. */
  edgeColorFn?: EdgeColorFn;
  /** Explicit type→color map for edges. */
  edgeColors?: Record<string, string>;
  /** Pool used for deterministic auto-assignment of node + edge colors. */
  palette?: readonly string[];
  /** Toggle visible labels per node. Default: true. */
  showLabels?: boolean;
  /** Toggle hover tooltip + colour change. Default: true. */
  enableHover?: boolean;
  /**
   * Pulse animation: `false` disables, `true` (or omitted) uses defaults,
   * an object lets the host tune period / amplitude / colour amplitude.
   * Hovered nodes are automatically excluded from the pulse so the active
   * node feels stable while interacted with.
   */
  pulse?: PulseOption;
  /**
   * Optional incoming-edge label map for the default tooltip's natural-language
   * description (e.g. `{ father_of: 'Son of', mother_of: 'Son of' }`). When
   * the consumer supplies a custom `tooltip.renderTooltip` / `tooltip.component`
   * this map is ignored. Keep raw edge types (no spaces); display names live
   * in the values.
   */
  incomingEdgeLabels?: EdgeLabelMap;
  /**
   * Optional outgoing-edge label map for the default tooltip's natural-language
   * description (e.g. `{ father_of: 'Father of' }`). Same caveats as
   * {@link SceneControllerOptions.incomingEdgeLabels}.
   */
  outgoingEdgeLabels?: EdgeLabelMap;
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
  private readonly edgeColorMap: EdgeColorMap;
  private readonly pulseController: PulseController;

  private container: HTMLElement | null = null;
  private labelOverlay: HTMLElement | null = null;

  private nodeMesh: NodeMesh | null = null;
  private edgeMesh: EdgeMesh | null = null;

  private layoutMode: LayoutMode;
  private layoutEngine: LayoutEngine;

  private nodeRender: NodeRenderConfig | undefined;
  private tooltip: TooltipConfig | undefined;
  private incomingEdgeLabels: EdgeLabelMap | undefined;
  private outgoingEdgeLabels: EdgeLabelMap | undefined;

  private showLabels: boolean;
  private enableHover: boolean;

  private nodeIdsByIndex: string[] = [];
  private nodesByIndex: NodeData[] = [];
  private edgeEndpoints: Array<{ sourceId: string; targetId: string }> = [];
  private baseColorsByIndex: string[] = [];

  /**
   * Per-mode cache of computed layout positions. Only the active layout is
   * ever computed — inactive layouts are NEVER invoked. Cleared whenever the
   * underlying graph data changes (in `syncFromStore`) so stale positions
   * don't outlive the data they describe.
   *
   * Static (non-animated) layouts (e.g. {@link TreeLayout}) take advantage
   * of this cache so toggling away and back doesn't re-run the layout.
   * Animated layouts (e.g. {@link ForceLayout3D}) always recompute on entry
   * — their internal physics state needs seeding and the recompute is cheap
   * — but their entry still goes through the same single-engine pathway
   * so the inactive layout remains untouched.
   */
  private layoutCache = new Map<LayoutMode, Map<string, Vector3>>();

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
    this.incomingEdgeLabels = options.incomingEdgeLabels;
    this.outgoingEdgeLabels = options.outgoingEdgeLabels;
    this.showLabels = options.showLabels ?? true;
    this.enableHover = options.enableHover ?? true;

    // Color resolution — applies to both backends. Short-form fields win
    // over the legacy `nodeColorOptions` bag where they overlap.
    const baseNodeOptions: NodeColorResolverOptions =
      options.nodeColorOptions ?? {};
    this.colorResolver = new NodeColorResolver({
      ...baseNodeOptions,
      palette: options.palette ?? baseNodeOptions.palette,
      nodeColors: options.nodeColors ?? baseNodeOptions.nodeColors,
      colorFn: options.nodeColorFn ?? baseNodeOptions.colorFn,
    });
    this.edgeColorMap = new EdgeColorMap({
      palette: options.palette,
      edgeColors: options.edgeColors,
      colorFn: options.edgeColorFn,
    });

    this.pulseController = new PulseController(options.pulse);
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

  /** The edge colour map (exposed for tests + advanced consumers). */
  getEdgeColorMap(): EdgeColorMap {
    return this.edgeColorMap;
  }

  /** The pulse controller (exposed for tests + advanced consumers). */
  getPulseController(): PulseController {
    return this.pulseController;
  }

  /** The camera controller (exposed for advanced consumers — rotation, framing, etc.). */
  getCameraController(): CameraController {
    return this.cameraController;
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
    this.baseColorsByIndex = [];
    this.hoveredIndex = null;
    this.pointerActive = false;
    this.pulseController.reset();

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
    this.baseColorsByIndex = this.nodesByIndex.map((n) => this.colorResolver.resolve(n));
    this.pulseController.reset();

    // The graph data just changed — every cached layout is stale. Drop
    // them so the next entry into any mode (active or otherwise) recomputes
    // from the fresh data. We deliberately do NOT pre-populate inactive
    // modes' caches: only the active layout runs on sync.
    this.layoutCache.clear();

    if (nodes.length === 0) return;

    // Compute positions for the ACTIVE layout only. Inactive layouts (e.g.
    // TreeLayout while in graph view) are never touched, so a buggy
    // inactive layout cannot leak compute cost or exceptions into the
    // active code path.
    const positions = this.computeActiveLayout();

    // Build the (single) instanced node mesh that holds every node.
    const nodeMesh = new NodeMesh(this.nodeRender);
    nodeMesh.createInstancedMesh(nodes.length);
    this.nodeIdsByIndex.forEach((id, index) => {
      const pos = positions.get(id) ?? { x: 0, y: 0, z: 0 };
      nodeMesh.updateInstance(index, pos, this.baseColorsByIndex[index]);
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
      edges.forEach((edge, index) => {
        const endpoints = this.edgeEndpoints[index];
        const source = positions.get(endpoints.sourceId) ?? { x: 0, y: 0, z: 0 };
        const target = positions.get(endpoints.targetId) ?? { x: 0, y: 0, z: 0 };
        edgeMesh.updateSegment(index, source, target);
        // Per-edge colour via the resolver — pushes a vertex-colour pair into
        // the underlying buffer so each edge can carry its own hue without
        // adding another draw call.
        const data = {
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          attributes: edge.attributes,
        };
        edgeMesh.setSegmentColor(index, this.edgeColorMap.resolve(data));
      });
      this.renderer.addEdgeMesh('__edges__', edgeMesh);
      this.edgeMesh = edgeMesh;
    }

    // Frame the camera so the freshly-laid-out graph is visible.
    this.frameToFit(positions);
  }

  /**
   * Switch layout mode at runtime. Lazily computes the new mode's positions
   * (via the active engine only — inactive layouts are never invoked) and
   * caches them so a later toggle back can short-circuit.
   *
   * Existing meshes are reused; only the per-instance positions are
   * rewritten.
   */
  setLayout(mode: LayoutMode): void {
    if (mode === this.layoutMode) return;
    this.layoutMode = mode;
    this.layoutEngine = SceneController.createLayoutEngine(mode);

    if (this.nodeIdsByIndex.length === 0) return;

    const positions = this.computeActiveLayout();
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

  /**
   * Reconfigure the pulse animation at runtime. Pass `false` to disable,
   * `true` (or `undefined`) to use defaults, or a partial config to tune
   * period / amplitude / colour amplitude.
   */
  setPulse(option: PulseOption): void {
    this.pulseController.setConfig(option);
    if (!this.pulseController.isEnabled() && this.nodeMesh) {
      // Snap every instance back to its resting position + colour so we
      // don't leave nodes frozen mid-pulse.
      const positions = this.layoutEngine.getPositions();
      this.applyPositions(positions);
    }
  }

  /** Toggle camera rotation gestures. Zoom + pan stay enabled. */
  setRotationEnabled(enabled: boolean): void {
    this.cameraController.setRotationEnabled(enabled);
  }

  /** Snap the camera back to the orientation captured at attach() time. */
  resetRotation(): void {
    this.cameraController.resetRotation();
  }

  // --- internals ---

  /**
   * Compute (or recover from cache) the positions for the active layout.
   *
   * This is the single chokepoint through which both `syncFromStore` and
   * `setLayout` go — it guarantees the inactive layout's `compute()` is
   * NEVER invoked, no matter how many times the consumer toggles modes.
   *
   * Cache rules:
   *  - Static layouts (e.g. {@link TreeLayout}, `animated === false`):
   *    cached. A toggle away and back skips the recompute entirely.
   *  - Animated layouts (e.g. {@link ForceLayout3D}, `animated === true`):
   *    always recompute on entry so the engine's internal physics state
   *    is seeded for the per-frame `tick()`. We still cache the freshly
   *    computed positions so consumers (like {@link applyPulse}) that read
   *    `getPositions()` between ticks see a consistent snapshot.
   *
   * The cache is invalidated wholesale by {@link syncFromStore} whenever
   * the underlying graph data changes.
   */
  private computeActiveLayout(): Map<string, Vector3> {
    const mode = this.layoutMode;
    const engine = this.layoutEngine;

    // Static layouts: short-circuit on cache hit. The inactive engine is
    // never touched even if a stale entry for the OTHER mode lives in the
    // cache — we only ever read by the active mode key.
    if (!engine.animated) {
      const cached = this.layoutCache.get(mode);
      if (cached) return cached;
    }

    const positions = engine.compute(this.nodeIdsByIndex, this.edgeEndpoints);
    this.layoutCache.set(mode, positions);
    return positions;
  }

  private applyPositions(positions: Map<string, Vector3>): void {
    if (this.nodeMesh) {
      this.nodeIdsByIndex.forEach((id, index) => {
        const pos = positions.get(id) ?? { x: 0, y: 0, z: 0 };
        const node = this.nodesByIndex[index];
        const isHover = this.hoveredIndex === index;
        const color = isHover
          ? this.colorResolver.resolveHover(node)
          : this.baseColorsByIndex[index] ?? this.colorResolver.resolve(node);
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

    // Trackball damping needs to be pumped every frame; without this, the
    // dynamic-damping smoothing never decays and the user feels a 1-frame
    // lag on every rotation.
    this.cameraController.update();

    // Pulse the resting (non-hovered) nodes — runs after layout tick so the
    // scale modulation is applied on top of the latest layout positions.
    this.applyPulse();

    // Project labels.
    if (this.showLabels) this.projectLabels();

    // Update hover state if pointer is over the canvas.
    if (this.enableHover && this.pointerActive) this.updateHover();
  }

  /**
   * Push pulse-driven scale + (optional) colour to every non-hovered node
   * instance. Uses the most recent layout positions so the underlying
   * physics tick + pulse stay in sync.
   */
  private applyPulse(): void {
    if (!this.nodeMesh) return;
    if (!this.pulseController.isEnabled()) return;
    if (this.nodeIdsByIndex.length === 0) return;
    this.pulseController.setExcludedIndex(this.hoveredIndex);
    const positions = this.layoutEngine.getPositions();
    if (positions.size === 0) return;
    this.pulseController.apply(
      this.nodeMesh,
      this.nodeIdsByIndex,
      positions,
      this.baseColorsByIndex,
    );
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
      : this.baseColorsByIndex[index] ?? this.colorResolver.resolve(node);
    // updateInstance writes both matrix + colour; keep matrix unchanged by
    // re-using the current position. Reset scale to the resting radius so
    // a hovered node doesn't inherit a mid-pulse size.
    this.nodeMesh.updateInstance(index, pos, color, this.nodeMesh.getRadius());
  }

  private showTooltip(node: NodeData): void {
    // Offset slightly so the tooltip doesn't sit under the cursor.
    const x = this.pointerX + 12;
    const y = this.pointerY + 12;

    // If the consumer supplied a custom renderer we delegate to the overlay
    // (which honours `tooltip.renderTooltip` / `tooltip.component`). Otherwise
    // we fill the overlay element with a multi-line natural-language summary
    // produced by `describeNode`, so the user sees prose like
    // "Son of Abraham and Sarah" instead of just the node's title.
    const hasCustomRenderer = !!this.tooltip?.renderTooltip;
    if (hasCustomRenderer) {
      this.tooltipOverlay.showNode(node, x, y);
      return;
    }

    const description = describeNode(this.store, node.id, {
      incomingLabels: this.incomingEdgeLabels,
      outgoingLabels: this.outgoingEdgeLabels,
    });

    if (description.lines.length === 0) {
      // Single-line tooltip — preserves the original behaviour for nodes
      // without relationships.
      this.tooltipOverlay.showNode(node, x, y);
      return;
    }

    // Build the rich tooltip via the raw `show()` API. We escape the inputs
    // to avoid HTML injection from attribute values.
    const titleHtml = `<div class="ig-tooltip-title">${escapeHtml(description.title)}</div>`;
    const lineHtml = description.lines
      .map((line) => `<div class="ig-tooltip-line">${escapeHtml(line)}</div>`)
      .join('');
    this.tooltipOverlay.show(`${titleHtml}${lineHtml}`, x, y);
  }

  /**
   * Update the incoming-edge label map used by the default tooltip's
   * natural-language description. Pass `undefined` to clear.
   */
  setIncomingEdgeLabels(labels: EdgeLabelMap | undefined): void {
    this.incomingEdgeLabels = labels;
  }

  /**
   * Update the outgoing-edge label map used by the default tooltip's
   * natural-language description. Pass `undefined` to clear.
   */
  setOutgoingEdgeLabels(labels: EdgeLabelMap | undefined): void {
    this.outgoingEdgeLabels = labels;
  }

  /** Active incoming-edge label map (for tests + introspection). */
  getIncomingEdgeLabels(): EdgeLabelMap | undefined {
    return this.incomingEdgeLabels;
  }

  /** Active outgoing-edge label map (for tests + introspection). */
  getOutgoingEdgeLabels(): EdgeLabelMap | undefined {
    return this.outgoingEdgeLabels;
  }

  /**
   * Push the camera back so the freshly-laid-out graph fills the viewport.
   *
   * The previous implementation used the absolute max distance from the
   * centroid as the bounding radius. That made one drifting outlier (e.g.
   * an orphan node with no edges, or a loosely-connected leaf) define the
   * frame, leaving the actual cluster occupying ~10% of the canvas.
   *
   * 0.1.11 algorithm:
   *   1. Compute the centroid using the 5th–95th percentile of each axis
   *      so a single outlier can't drag the centroid off the cluster.
   *   2. Compute the bounding radius as the 95th-percentile distance from
   *      the trimmed centroid (not the max). Outliers beyond that radius
   *      may still sit in the camera's view but they don't define the
   *      frame.
   *   3. Convert that radius to an orbit distance assuming the camera's
   *      vertical FOV (Three.js default 50°) and a 0.8 fill factor — i.e.
   *      the cluster sphere should subtend ~80% of the viewport height.
   */
  private frameToFit(positions: Map<string, Vector3>): void {
    if (positions.size === 0) return;

    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (const p of positions.values()) {
      xs.push(p.x);
      ys.push(p.y);
      zs.push(p.z);
    }
    const cx = SceneController.percentileMidpoint(xs);
    const cy = SceneController.percentileMidpoint(ys);
    const cz = SceneController.percentileMidpoint(zs);

    // Distance-from-centroid distribution. Use the 95th percentile so a
    // single drifting outlier doesn't define the frame.
    const dists: number[] = [];
    for (const p of positions.values()) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dz = p.z - cz;
      dists.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    dists.sort((a, b) => a - b);
    const p95 = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.95))] ?? 0;

    // Convert the framed radius to an orbit distance. We solve the standard
    // FOV equation: tan(fov/2) = radius / distance, and add a 1.25× factor
    // (== 1 / 0.8 fill) so the cluster sphere occupies ~80% of the viewport.
    const camera = this.renderer.getCamera();
    const fovDeg =
      camera && typeof camera.fov === 'number' && Number.isFinite(camera.fov)
        ? camera.fov
        : 60;
    const halfFov = ((fovDeg * Math.PI) / 180) / 2;
    const fillFactor = 0.8;
    const framedRadius = Math.max(p95, 1);
    const distance = (framedRadius / Math.tan(halfFov)) / fillFactor;
    const radius = Math.max(80, distance);

    this.cameraController.setTarget({ x: cx, y: cy, z: cz });
    this.cameraController.setRadius(radius);
  }

  /**
   * Mean of the 5th and 95th percentiles of a sorted-or-unsorted numeric
   * array. Used by {@link frameToFit} to compute an outlier-resistant
   * centroid.
   */
  private static percentileMidpoint(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.05)];
    const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    return (lo + hi) / 2;
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
