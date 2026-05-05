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
import { InferredEdgeMesh } from './InferredEdgeMesh.js';
import { TreeNodeMesh } from './TreeNodeMesh.js';
import {
  TreeEdgeMesh,
  buildTreeEdgeSegments,
  type TreeEdgeSegment,
} from './TreeEdgeMesh.js';
import { LabelRenderer } from './LabelRenderer.js';
import { AnnotationRenderer } from './AnnotationRenderer.js';
import { ExpandAffordance } from './ExpandAffordance.js';
import { Raycaster } from './Raycaster.js';
import { TooltipOverlay } from '../overlay/TooltipOverlay.js';
import {
  NodeColorResolver,
  type NodeColorFn,
  type NodeColorResolverOptions,
} from './NodeColorResolver.js';
import {
  EdgeColorMap,
  DEFAULT_EDGE_COLOR,
  type EdgeColorFn,
} from './EdgeColorMap.js';
import { PulseController, type PulseOption } from './PulseController.js';
import { describeNode } from '../utils/describeNode.js';
import type { EdgeLabelMap } from '../utils/aggregateEdges.js';
import type { InferredEdge } from '../ai/InferredEdge.js';
import type { InferredEdgeHost } from './types.js';

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

/**
 * A frozen capture of a camera + its orbit target. Used by
 * {@link SceneController} to preserve per-mode camera state across
 * graph/tree toggles so user pan/zoom/rotate gestures in one view do not
 * bleed into the other.
 *
 *   - `position`: world-space camera location.
 *   - `quaternion`: orientation. (Tree mode is locked axis-aligned, so its
 *     captured quaternion is just the identity by construction; graph mode
 *     uses the live trackball orientation.)
 *   - `zoom`: orthographic zoom factor. The perspective camera ignores
 *     this on restore (its zoom is always 1) but we still capture it so
 *     the snapshot type is uniform between modes.
 *   - `target`: the trackball look-at point (== orbit centre).
 */
export interface CameraSnapshot {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  zoom: number;
  target: { x: number; y: number; z: number };
}

/**
 * Capture the live camera + controls target into a {@link CameraSnapshot}.
 * Reads the orientation off the camera's quaternion (kept in sync by Three's
 * `lookAt` and the trackball gestures) and the orbit centre from
 * `CameraController.getTarget()`.
 *
 * Only public properties are touched; the camera is not mutated.
 */
function captureCameraState(
  camera: THREE.Camera,
  target: Vector3,
): CameraSnapshot {
  const cam = camera as THREE.Camera & {
    position: { x: number; y: number; z: number };
    quaternion?: { x: number; y: number; z: number; w: number };
    zoom?: number;
  };
  const q = cam.quaternion;
  return {
    position: {
      x: cam.position.x,
      y: cam.position.y,
      z: cam.position.z,
    },
    quaternion: q
      ? { x: q.x, y: q.y, z: q.z, w: q.w }
      : { x: 0, y: 0, z: 0, w: 1 },
    zoom: typeof cam.zoom === 'number' ? cam.zoom : 1,
    target: { x: target.x, y: target.y, z: target.z },
  };
}

/**
 * Restore a {@link CameraSnapshot} onto the live camera + controls. The
 * snapshot's target is pushed through {@link CameraController.setTarget} so
 * the underlying TrackballControls picks it up; the camera's position +
 * orientation + zoom are written directly so the prior eye vector is
 * preserved verbatim (we deliberately bypass `setTarget`'s side-effect of
 * placing the camera at `radius` along the look direction — that would
 * erase the saved position).
 *
 * After the live transform is restored we call
 * {@link CameraController.syncFromCamera} so the controller's cached
 * `radius` AND the underlying TrackballControls' damping accumulators are
 * re-derived from the just-restored state. Without that sync, the
 * trackball's per-frame `update()` would apply leftover rotation / zoom /
 * pan inertia from the previous mode and visibly slide the camera off
 * the snapshot during the first few ticks — the bug 0.1.18 was supposed
 * to fix.
 */
function applyCameraState(
  camera: THREE.Camera,
  cameraController: CameraController,
  snapshot: CameraSnapshot,
): void {
  const cam = camera as THREE.Camera & {
    position: {
      x: number;
      y: number;
      z: number;
      set: (x: number, y: number, z: number) => unknown;
    };
    quaternion?: {
      x: number;
      y: number;
      z: number;
      w: number;
      set?: (x: number, y: number, z: number, w: number) => unknown;
    };
    zoom?: number;
    updateProjectionMatrix?: () => void;
  };

  // 1. Push the orbit centre into the trackball + the controller's cached
  //    target. We do NOT use `setTarget` because its `placeCameraAtRadius`
  //    side-effect would clobber the camera position we're about to restore.
  const controls = cameraController.getControls();
  if (controls) {
    controls.target.set(
      snapshot.target.x,
      snapshot.target.y,
      snapshot.target.z,
    );
  }
  // Mirror the new target into the controller's private cache via the
  // public setter, but immediately undo its position-placement side-effect
  // by writing the saved camera position over the top.
  cameraController.setTarget(snapshot.target);

  // 2. Restore the camera transform.
  cam.position.set(
    snapshot.position.x,
    snapshot.position.y,
    snapshot.position.z,
  );
  if (cam.quaternion?.set) {
    cam.quaternion.set(
      snapshot.quaternion.x,
      snapshot.quaternion.y,
      snapshot.quaternion.z,
      snapshot.quaternion.w,
    );
  }
  if (typeof cam.zoom === 'number') {
    cam.zoom = snapshot.zoom;
    cam.updateProjectionMatrix?.();
  }

  // 3. CRITICAL: re-derive the controller's cached radius AND zero out the
  //    trackball's damping accumulators so the next per-frame `update()`
  //    is a no-op. Without this, residual inertia from the OUTGOING mode
  //    (e.g. a half-decayed rotation gesture) would slide the freshly
  //    restored camera away from the snapshot over the next ~10 frames.
  cameraController.syncFromCamera();
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
  /**
   * Domain-agnostic visibility predicate. When supplied, only nodes for
   * which the predicate returns `true` are rendered; edges whose source
   * OR target node is filtered out are hidden too.
   *
   * The same predicate applies in **every** visualization mode — graph,
   * tree, and any future mode (geospatial / timeline / chord / etc.).
   * Each mesh class implements the internal `VisibilityHost` contract
   * and the SceneController dispatches a single `setVisibility` call to
   * each on every filter change.
   *
   * Filter changes are applied as in-place visibility toggles on the
   * existing GPU buffers — there's NO mesh teardown, NO rebuild, and
   * NO layout recompute. Hidden nodes keep their layout positions, so
   * unhiding restores the prior frame instantly.
   *
   * Default: `() => true` (no filter).
   */
  filter?: (node: NodeData) => boolean;
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
export class SceneController implements InferredEdgeHost {
  private readonly store: GraphStore;
  private readonly renderer = new WebGLRenderer();
  private readonly cameraController = new CameraController();
  private readonly labelRenderer = new LabelRenderer();
  private readonly annotationRenderer = new AnnotationRenderer();
  private readonly expandAffordance = new ExpandAffordance();
  private readonly raycaster = new Raycaster();
  private readonly tooltipOverlay = new TooltipOverlay();
  private readonly colorResolver: NodeColorResolver;
  private readonly edgeColorMap: EdgeColorMap;
  private readonly pulseController: PulseController;

  private container: HTMLElement | null = null;
  private labelOverlay: HTMLElement | null = null;
  private annotationOverlay: HTMLElement | null = null;
  /**
   * Optional handler installed via {@link setOnExpandRequest}. When
   * the user clicks the "+" affordance the affordance fires this
   * handler with the node id, and the React layer dispatches the
   * neighbor expansion. `null` means "no consumer wired up" — the
   * click is silently dropped.
   */
  private onExpandRequest: ((nodeId: string) => void) | null = null;
  /**
   * Highlight set dispatched to every mounted mesh's `setHighlight`
   * each time {@link applyHighlightMask} runs. Empty = baseline (no
   * dim). Same shape as visibility — uniform across modes.
   */
  private highlightIds: Set<string> = new Set();

  private nodeMesh: NodeMesh | null = null;
  private edgeMesh: EdgeMesh | null = null;
  /**
   * Phase 5 inferred-edge overlay mesh. Mounted in graph mode (built
   * inside {@link buildGraphMeshes} as an empty mesh, populated by the
   * first {@link setInferredEdges} call). Tree mode does not mount one
   * — `setInferredEdges` / `setInferredEdgeVisibility` are no-ops with
   * `console.debug` notes per the Phase 5 plan's tree-mode-deferred
   * decision.
   */
  private inferredEdgeMesh: InferredEdgeMesh | null = null;
  /**
   * Cached inferred edges from the most recent
   * {@link setInferredEdges} call. Replayed onto the freshly-built
   * {@link inferredEdgeMesh} after a graph-mode rebuild (e.g. the user
   * toggles `layout` from 'tree' back to 'graph') so the overlay
   * survives the round-trip.
   */
  private lastInferredEdges: ReadonlyArray<InferredEdge> = [];
  /**
   * Cached visibility flag for the inferred-edge overlay. Default
   * `false` matches the {@link InferredEdgeMesh} default + the
   * `showInferredEdges` prop default. Replayed onto the freshly-built
   * mesh on graph-mode re-entry alongside {@link lastInferredEdges}.
   */
  private inferredEdgesVisible: boolean = false;

  /**
   * Tree-mode meshes. Mounted only when {@link layoutMode} === 'tree'
   * and torn down on the way back to the graph mode. Sphere/line meshes
   * (`nodeMesh` / `edgeMesh`) are left in place but hidden so toggling is
   * cheap.
   */
  private treeNodeMesh: TreeNodeMesh | null = null;
  private treeEdgeMesh: TreeEdgeMesh | null = null;

  /**
   * The perspective camera created by WebGLRenderer at attach time.
   * Stashed so we can restore it when toggling back to the graph view —
   * tree mode swaps in an OrthographicCamera.
   */
  private perspectiveCamera: THREE.PerspectiveCamera | null = null;
  /**
   * Lazily-created orthographic camera used by the tree view. Built on
   * first entry to tree mode.
   */
  private orthographicCamera: THREE.OrthographicCamera | null = null;

  private layoutMode: LayoutMode;
  private layoutEngine: LayoutEngine;

  /**
   * Per-mode camera snapshots. Captured on the way OUT of a mode so the
   * next entry into that mode can restore the user's prior pan / zoom /
   * (graph-mode) rotation. `null` means "no prior state — initialise via
   * frameToFit on next entry".
   *
   * The two views are completely independent: mutating the live camera
   * while in graph mode never touches `treeCameraSnapshot` and vice versa.
   *
   * Cleared by {@link syncFromStore} because new layout positions
   * invalidate any saved frame (the saved target / radius reference the
   * old coordinate space).
   */
  private graphCameraSnapshot: CameraSnapshot | null = null;
  private treeCameraSnapshot: CameraSnapshot | null = null;

  private nodeRender: NodeRenderConfig | undefined;
  private tooltip: TooltipConfig | undefined;
  private incomingEdgeLabels: EdgeLabelMap | undefined;
  private outgoingEdgeLabels: EdgeLabelMap | undefined;
  /**
   * Domain-agnostic visibility predicate. Default `() => true` accepts
   * every node. Replaced via {@link setFilter}; never branched on
   * layout mode — the same predicate flows through to every mesh.
   */
  private nodeFilter: (node: NodeData) => boolean;

  private showLabels: boolean;
  private enableHover: boolean;

  private nodeIdsByIndex: string[] = [];
  private nodesByIndex: NodeData[] = [];
  private edgeIdsByIndex: string[] = [];
  private edgeEndpoints: Array<{ sourceId: string; targetId: string; type?: string }> = [];
  private baseColorsByIndex: string[] = [];

  /**
   * Cached filter result, recomputed by {@link recomputeVisibility}
   * whenever {@link setFilter} runs OR new meshes are built. Both maps
   * are passed into the per-mesh `VisibilityHost` implementations on
   * each {@link applyFilterMask} call. Tree-edge meshes consume
   * `visibleNodeIds` (their endpoints are nodes); graph-edge meshes
   * consume `visibleEdgeIds`.
   */
  private visibleNodeIds: Set<string> = new Set();
  private visibleEdgeIds: Set<string> = new Set();

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

  /**
   * Phase 6 — node-body click handler. Fired by the pointerdown/pointerup
   * pair when the user releases a click on a node body (not on the "+"
   * affordance). `null` means "no consumer wired up" — clicks become a
   * no-op for the host but still feed the camera controls underneath.
   */
  private onNodeClick: ((nodeId: string) => void) | null = null;
  /** Pointer-down screen coords + node id (when a node was hit). */
  private pointerDown: { x: number; y: number; nodeId: string | null } | null = null;
  /**
   * Maximum drift between pointerdown and pointerup (in CSS pixels) before
   * we treat the gesture as a drag and suppress the click. Matches the
   * threshold most browsers use internally.
   */
  private static readonly CLICK_DRIFT_THRESHOLD = 6;

  // Bound handlers (so we can remove them).
  private onPointerMoveBound = this.onPointerMove.bind(this);
  private onPointerLeaveBound = this.onPointerLeave.bind(this);
  private onPointerDownBound = this.onPointerDown.bind(this);
  private onPointerUpBound = this.onPointerUp.bind(this);
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
    this.nodeFilter = options.filter ?? (() => true);
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
      // The renderer creates a PerspectiveCamera at attach time. Stash it
      // so toggling between graph (perspective) and tree (orthographic)
      // views can restore it later.
      if (camera instanceof THREE.PerspectiveCamera) {
        this.perspectiveCamera = camera;
      }
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

    // Annotation overlay — sibling of the label overlay; lives in its own
    // div so styling / pointer-events can differ from labels (annotations
    // are interactive).
    this.annotationOverlay = document.createElement('div');
    this.annotationOverlay.className = 'ig-annotation-overlay';
    this.annotationOverlay.style.position = 'absolute';
    this.annotationOverlay.style.inset = '0';
    this.annotationOverlay.style.pointerEvents = 'none';
    this.annotationOverlay.style.overflow = 'hidden';
    container.appendChild(this.annotationOverlay);
    this.annotationRenderer.attach(this.annotationOverlay);

    // "+" hover affordance. Mounts its own sibling overlay
    // (`.ig-affordance-overlay`, z-index 6 — above labels at 5, below
    // tooltip at 100) so its pointer-events policy stays independent
    // of labels + annotations.
    this.expandAffordance.attach(container);
    this.expandAffordance.setOnExpand((nodeId) => {
      // Forward to the consumer-registered handler (if any). Keeping
      // this as a closure means setOnExpandRequest can be called at
      // any time after attach without re-registering on the
      // affordance itself.
      this.onExpandRequest?.(nodeId);
    });

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

    // Phase 6 — node-body click. Dispatches the consumer-registered
    // `onNodeClick` handler when the user releases a click directly on
    // a node (not on the "+" affordance, which has its own handler).
    // Listens for `pointerdown`/`pointerup` so we can suppress drags.
    container.addEventListener('pointerdown', this.onPointerDownBound);
    container.addEventListener('pointerup', this.onPointerUpBound);

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
    this.container.removeEventListener('pointerdown', this.onPointerDownBound);
    this.container.removeEventListener('pointerup', this.onPointerUpBound);

    this.renderer.removeTickCallback(this.tickBound);
    this.cameraController.detach();
    this.labelRenderer.clear();
    this.annotationRenderer.detach();
    this.expandAffordance.detach();
    this.tooltipOverlay.detach();

    if (this.labelOverlay) {
      this.labelOverlay.remove();
      this.labelOverlay = null;
    }
    if (this.annotationOverlay) {
      this.annotationOverlay.remove();
      this.annotationOverlay = null;
    }

    this.renderer.detach();

    this.nodeMesh = null;
    this.edgeMesh = null;
    if (this.inferredEdgeMesh) {
      this.inferredEdgeMesh.dispose();
      this.inferredEdgeMesh = null;
    }
    // Drop the inferred-edge cache too — a full detach is a hard
    // reset. The next attach starts the overlay hidden + empty,
    // matching the React prop default.
    this.lastInferredEdges = [];
    this.inferredEdgesVisible = false;
    this.nodeIdsByIndex = [];
    this.nodesByIndex = [];
    this.edgeIdsByIndex = [];
    this.edgeEndpoints = [];
    this.baseColorsByIndex = [];
    this.visibleNodeIds = new Set();
    this.visibleEdgeIds = new Set();
    this.highlightIds = new Set();
    this.hoveredIndex = null;
    this.pointerActive = false;
    this.pulseController.reset();

    // Detaching wipes the underlying TrackballControls and (potentially)
    // the cameras themselves; saved snapshots reference state that no
    // longer exists. Clear them so the next attach starts fresh.
    this.graphCameraSnapshot = null;
    this.treeCameraSnapshot = null;

    // The expand-affordance click handler captures `this` via the
    // `setOnExpand` closure installed in `attach()`; the next attach
    // re-installs it. The consumer-registered handler outlives detach
    // (the React layer re-wires on remount), so we leave it intact.

    this.container = null;
  }

  /**
   * Read all nodes + edges from the store, run the layout, and (re)build the
   * meshes that the WebGLRenderer renders. Idempotent.
   */
  syncFromStore(): void {
    if (!this.container) return;

    // Clear any previous meshes so we can rebuild from scratch.
    this.teardownGraphMeshes();
    this.teardownTreeMeshes();
    this.labelRenderer.clear();
    this.hoveredIndex = null;

    const nodes = this.store.getAllNodes();
    const edges = this.store.getAllEdges();

    this.nodeIdsByIndex = nodes.map((n) => n.id);
    this.nodesByIndex = nodes.slice();
    this.edgeIdsByIndex = edges.map((e) => e.id);
    // Capture the edge `type` (e.g. `father_of`, `husband_of`) alongside the
    // endpoints so the active layout can consult it. The tree layout uses
    // the type to distinguish parent edges from spouse edges; force
    // layouts ignore it.
    this.edgeEndpoints = edges.map((e) => ({
      sourceId: e.sourceId,
      targetId: e.targetId,
      type: typeof e.attributes?.type === 'string' ? e.attributes.type : undefined,
    }));
    this.baseColorsByIndex = this.nodesByIndex.map((n) => this.colorResolver.resolve(n));
    this.pulseController.reset();
    // Recompute the cached visibility id sets from the freshly-loaded
    // graph data. The mesh-level masks are applied in `buildGraph/Tree
    // Meshes` after the meshes exist.
    this.recomputeVisibility();

    // The graph data just changed — every cached layout is stale. Drop
    // them so the next entry into any mode (active or otherwise) recomputes
    // from the fresh data. We deliberately do NOT pre-populate inactive
    // modes' caches: only the active layout runs on sync.
    this.layoutCache.clear();

    // Saved per-mode camera snapshots reference the prior layout's
    // coordinates and bounding radius. Drop them so the next entry into
    // the inactive mode falls through to the first-entry default
    // (frameToFit + tree axis-align) instead of restoring stale state.
    this.graphCameraSnapshot = null;
    this.treeCameraSnapshot = null;

    if (nodes.length === 0) return;

    // Compute positions for the ACTIVE layout only. Inactive layouts (e.g.
    // TreeLayout while in graph view) are never touched, so a buggy
    // inactive layout cannot leak compute cost or exceptions into the
    // active code path.
    const positions = this.computeActiveLayout();

    // Build the right meshes for the active layout mode + frame the camera.
    // Both snapshots were just cleared above, so this is always a
    // first-entry default for the active mode: frameToFit + (tree only)
    // axis-align the orthographic camera.
    if (this.layoutMode === 'tree') {
      this.applyTreeCamera();
      this.buildTreeMeshes(positions);
    } else {
      this.applyGraphCamera();
      this.buildGraphMeshes(edges, positions);
    }
    // Apply the cached visibility mask to the freshly-built meshes so
    // an existing filter predicate carries through `syncFromStore`
    // without an extra round-trip to the host.
    this.applyFilterMask();
    // Frame to the visible nodes only — the consumer's `filter` may
    // have hidden a chunk of the data set; centring the camera on the
    // unfiltered centroid would leave the visible cluster off-axis.
    this.frameToFit(this.framingPositions(positions));
    // Tree first-entry: re-assert axis-alignment AFTER frameToFit so the
    // orthographic eye is purely along +Z relative to the freshly-framed
    // tree centroid. (frameToFit's setTarget→placeCameraAtRadius preserves
    // whatever direction the prior eye vector pointed in — which, on the
    // graph→tree transition, can carry residual X/Y components from the
    // prior perspective camera state. Resetting last guarantees a clean
    // axis-aligned eye regardless of the incoming state.)
    if (this.layoutMode === 'tree') {
      this.cameraController.resetCameraOrientation();
    }
  }

  /**
   * Restrict a positions map to the nodes that are actually visible
   * under the current filter predicate. The same predicate applies
   * across modes, so framing always centres on the visible subset
   * regardless of which layout is active. When the predicate accepts
   * everything (the default), the input positions map is returned
   * verbatim without allocation.
   */
  private framingPositions(positions: Map<string, Vector3>): Map<string, Vector3> {
    const visible = this.visibleNodeIds;
    if (visible.size === 0 || visible.size === positions.size) return positions;
    const out = new Map<string, Vector3>();
    for (const [id, p] of positions) {
      if (visible.has(id)) out.set(id, p);
    }
    return out;
  }

  /**
   * Build the graph-view meshes (instanced sphere + line segments per
   * edge) and HTML labels. Called from {@link syncFromStore} and on entry
   * to graph mode from {@link setLayout}.
   */
  private buildGraphMeshes(
    edges: ReturnType<GraphStore['getAllEdges']>,
    positions: Map<string, Vector3>,
  ): void {
    const nodeMesh = new NodeMesh(this.nodeRender);
    nodeMesh.createInstancedMesh(this.nodesByIndex.length);
    nodeMesh.setNodeIds(this.nodeIdsByIndex);
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
      edgeMesh.setEdgeIds(this.edgeIdsByIndex);
      // Endpoint mapping powers `setHighlight` (an edge's highlight
      // state depends on whether BOTH of its endpoint nodes are
      // highlighted). The visibility path uses the edge-id set so it
      // doesn't need this; but feeding both keeps the mesh's two
      // hosts (VisibilityHost + HighlightHost) self-contained.
      edgeMesh.setEdgeEndpoints(
        this.edgeEndpoints.map((ep) => ({
          sourceId: ep.sourceId,
          targetId: ep.targetId,
        })),
      );
      // Index endpoint nodes by id so we can hand the resolver the
      // already-resolved source / target colours from `baseColorsByIndex`
      // — picking the same hex {@link NodeColorResolver.resolve} returned
      // for those nodes. This keeps `edgeColorFn` consumers (notably
      // {@link blendEdgeColors}) consistent with the rendered node hues.
      const indexById = new Map<string, number>();
      this.nodeIdsByIndex.forEach((id, i) => indexById.set(id, i));
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
        const sIdx = indexById.get(endpoints.sourceId);
        const tIdx = indexById.get(endpoints.targetId);
        const ctx = {
          sourceColor:
            (typeof sIdx === 'number' ? this.baseColorsByIndex[sIdx] : undefined) ??
            DEFAULT_EDGE_COLOR,
          targetColor:
            (typeof tIdx === 'number' ? this.baseColorsByIndex[tIdx] : undefined) ??
            DEFAULT_EDGE_COLOR,
        };
        edgeMesh.setSegmentColor(index, this.edgeColorMap.resolve(data, ctx));
      });
      this.renderer.addEdgeMesh('__edges__', edgeMesh);
      this.edgeMesh = edgeMesh;
    }

    // Phase 5: mount the inferred-edge overlay as an empty mesh. The
    // first `setInferredEdges` call (driven by AIEngine /
    // computeInferredEdges) resizes its geometry to fit. Building it
    // empty here keeps the mount path on the same edges-built code
    // path — visibility + replay are handled below.
    const inferredEdgeMesh = new InferredEdgeMesh();
    // Replay any cached overlay state captured before this build —
    // e.g. user toggled `showInferredEdges` while in tree mode, or
    // `setInferredEdges` arrived during a tree-mode session. The
    // freshly-built mesh starts from the cached data so the overlay
    // survives layout round-trips without the host re-pushing it.
    if (this.lastInferredEdges.length > 0 && positions.size > 0) {
      inferredEdgeMesh.setInferredEdges(this.lastInferredEdges, positions);
    }
    inferredEdgeMesh.setVisibility(this.inferredEdgesVisible);
    const overlayMesh = inferredEdgeMesh.getMesh();
    if (overlayMesh) {
      this.renderer.addObject('__inferred_edges__', overlayMesh);
    }
    this.inferredEdgeMesh = inferredEdgeMesh;
  }

  /**
   * Build the tree-view meshes:
   *   - A {@link TreeNodeMesh} (one rounded-rect card per node, fill
   *     translucent dark, outline = node colour, with the node's title
   *     rasterised inside).
   *   - A {@link TreeEdgeMesh} containing the orthogonal connectors
   *     (marriage line, parent-to-bar drop, sibling bar, drops to
   *     children).
   *
   * Called from {@link syncFromStore} and on entry to tree mode from
   * {@link setLayout}.
   *
   * Cards are built for **every** node — the predicate is applied
   * AFTER build via {@link applyFilterMask} which calls
   * `treeNodeMesh.setVisibility(...)` to hide filter-rejected cards.
   * This keeps the build path mode-agnostic and makes a future filter
   * change a per-frame no-op (no rebuild).
   */
  private buildTreeMeshes(positions: Map<string, Vector3>): void {
    const treeNodeMesh = new TreeNodeMesh();
    const entries: Array<{
      id: string;
      position: Vector3;
      color: string;
      label?: string;
    }> = [];
    this.nodeIdsByIndex.forEach((id, index) => {
      const node = this.nodesByIndex[index];
      const labelText = SceneController.getLabelText(node);
      entries.push({
        id,
        position: positions.get(id) ?? { x: 0, y: 0, z: 0 },
        color: this.baseColorsByIndex[index],
        label: labelText ?? undefined,
      });
    });
    treeNodeMesh.build(entries);
    const root = treeNodeMesh.getMesh();
    if (root) this.renderer.addObject('__tree_nodes__', root);
    this.treeNodeMesh = treeNodeMesh;

    // Tree-mode labels are rasterised inside each card by the TreeNodeMesh
    // itself; the HTML LabelRenderer is intentionally NOT populated here.
    // Leaving HTML labels in place would project them through whichever
    // camera the renderer holds — when the user toggles into tree mode,
    // those projections collapse to (0,0) of the screen because the
    // graph-mode label set still references the prior force-layout
    // positions / projection matrix. Keeping the tree-mode label set
    // empty is the simplest fix and makes the tree view self-contained.

    // Raycast targets are the per-card groups (each carries
    // `userData.nodeId`). Filter-rejected cards have `group.visible ===
    // false` after the post-build `applyFilterMask` call, and the
    // raycaster's standard intersect path naturally rejects invisible
    // Object3Ds — so filtered cards don't produce ghost hits.
    this.raycaster.setObjects(treeNodeMesh.getRaycastTargets());
    this.raycaster.setNodeIds(this.nodeIdsByIndex);
    const cam = this.renderer.getCamera();
    if (cam) this.raycaster.setCamera(cam);

    // Build the orthogonal connectors from the tree topology + positions.
    // ALL connectors are built; the post-build `applyFilterMask` call
    // hides those whose endpoint nodes are filtered out by setting
    // alpha=0 on the appropriate vertex-colour-buffer slots.
    const segments = this.computeTreeEdgeSegments(positions);
    if (segments.length > 0) {
      const treeEdgeMesh = new TreeEdgeMesh();
      treeEdgeMesh.build(segments);
      const mesh = treeEdgeMesh.getMesh();
      if (mesh) this.renderer.addObject('__tree_edges__', mesh);
      this.treeEdgeMesh = treeEdgeMesh;
    }
  }

  private teardownGraphMeshes(): void {
    if (this.nodeMesh) {
      this.renderer.removeNodeMesh('__nodes__');
      this.nodeMesh = null;
    }
    if (this.edgeMesh) {
      this.renderer.removeEdgeMesh('__edges__');
      this.edgeMesh = null;
    }
    if (this.inferredEdgeMesh) {
      this.renderer.removeObject('__inferred_edges__');
      this.inferredEdgeMesh.dispose();
      this.inferredEdgeMesh = null;
    }
  }

  private teardownTreeMeshes(): void {
    if (this.treeNodeMesh) {
      this.renderer.removeObject('__tree_nodes__');
      this.treeNodeMesh.dispose();
      this.treeNodeMesh = null;
    }
    if (this.treeEdgeMesh) {
      this.renderer.removeObject('__tree_edges__');
      this.treeEdgeMesh.dispose();
      this.treeEdgeMesh = null;
    }
  }

  /**
   * Walk the typed edge list to derive parent→child and spouse
   * relationships, then produce the orthogonal-connector line segments
   * required by the tree view.
   *
   * Output composition for each parent or couple:
   *   - 1 horizontal marriage line per couple.
   *   - 1 vertical drop from the parent / couple-midpoint to a sibling-
   *     bar y (`LEVEL_HEIGHT / 2` above the children).
   *   - 1 horizontal sibling bar spanning all children at that y.
   *   - 1 vertical drop from the bar to each child's top edge.
   *
   * For a single child the sibling bar collapses to a 0-length
   * horizontal step (we still emit it so the connector reaches the bar
   * y consistently).
   */
  private computeTreeEdgeSegments(
    positions: Map<string, Vector3>,
  ): TreeEdgeSegment[] {
    const cardSize = this.treeNodeMesh?.getCardSize() ?? {
      width: TreeNodeMesh.DEFAULT_WIDTH,
      height: TreeNodeMesh.DEFAULT_HEIGHT,
    };
    // ALL edges go through. Per-segment visibility is applied later via
    // `treeEdgeMesh.setVisibility(visibleNodeIds)` so connectors hide
    // when either endpoint is filtered out.
    return buildTreeEdgeSegments(positions, this.edgeEndpoints, cardSize);
  }

  /**
   * Switch to the orthographic camera + lock rotation. Lazily builds the
   * camera on first call. Keeps zoom + pan enabled.
   */
  private applyTreeCamera(): void {
    if (!this.container) return;
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    if (!this.orthographicCamera) {
      // World-space height is set by `frameToFit` after the layout runs.
      // Seed with sensible defaults so the camera object is valid before
      // the first `frameToFit`.
      const aspect = width / height;
      const worldHeight = 600;
      const worldWidth = worldHeight * aspect;
      const ortho = new THREE.OrthographicCamera(
        -worldWidth / 2,
        worldWidth / 2,
        worldHeight / 2,
        -worldHeight / 2,
        -10000,
        10000,
      );
      ortho.position.set(0, 0, 500);
      ortho.up.set(0, 1, 0);
      ortho.lookAt(new THREE.Vector3(0, 0, 0));
      this.orthographicCamera = ortho;
    } else {
      // Keep the projection matrix in sync with the current viewport.
      const aspect = width / height;
      const worldHeight =
        this.orthographicCamera.top - this.orthographicCamera.bottom;
      const worldWidth = worldHeight * aspect;
      this.orthographicCamera.left = -worldWidth / 2;
      this.orthographicCamera.right = worldWidth / 2;
      this.orthographicCamera.updateProjectionMatrix();
    }

    this.renderer.setCamera(this.orthographicCamera);
    this.cameraController.swapCamera(this.orthographicCamera);
    // Rotation makes no sense in a planar tree view — lock it. Zoom + pan
    // stay live so the user can navigate large family trees.
    this.cameraController.setRotationEnabled(false);
    // NOTE: axis-alignment is owned by the FIRST-ENTRY default path in
    // `setLayout` / `syncFromStore`, not by this swap. On subsequent
    // entries to tree mode the saved snapshot's transform is restored
    // verbatim, so calling `resetCameraOrientation` here would clobber
    // the user's pan/zoom from their previous tree-mode session.
    this.raycaster.setCamera(this.orthographicCamera);
  }

  /**
   * Restore the perspective camera + free rotation when entering graph
   * mode.
   */
  private applyGraphCamera(): void {
    if (!this.container || !this.perspectiveCamera) return;
    this.renderer.setCamera(this.perspectiveCamera);
    this.cameraController.swapCamera(this.perspectiveCamera);
    this.cameraController.setRotationEnabled(true);
    this.raycaster.setCamera(this.perspectiveCamera);
  }

  /**
   * Switch layout mode at runtime. Lazily computes the new mode's positions
   * (via the active engine only — inactive layouts are never invoked) and
   * caches them so a later toggle back can short-circuit.
   *
   * Per-mode camera state is preserved across toggles:
   *   1. The OUTGOING mode's live camera (position / orientation / zoom /
   *      target) is snapshotted into `graphCameraSnapshot` or
   *      `treeCameraSnapshot`.
   *   2. The cameras are swapped + rotation gates are applied (tree
   *      locks rotation, graph re-enables it).
   *   3. If the INCOMING mode has a prior snapshot, it is restored
   *      verbatim — the user's pan / zoom / (graph) rotation from the
   *      last visit to that mode survives the round-trip.
   *   4. If no snapshot exists (first-ever entry to that mode in this
   *      controller's lifetime, or a `syncFromStore` cleared them),
   *      `frameToFit` initialises a sensible default. Tree's first-entry
   *      default also calls `resetCameraOrientation` so the orthographic
   *      projection is axis-aligned.
   *
   * Mutating the live camera in one mode never touches the other mode's
   * snapshot — the two views are independent.
   *
   * Existing meshes are reused; only the per-instance positions are
   * rewritten.
   */
  setLayout(mode: LayoutMode): void {
    if (mode === this.layoutMode) return;

    // 1. Snapshot the OUTGOING mode's camera state (pan / zoom / rotation /
    //    target) before we touch any cameras. This is the single point at
    //    which user gestures in the soon-to-be-inactive mode are captured.
    const outgoingMode = this.layoutMode;
    const outgoingCamera = this.renderer.getCamera();
    if (outgoingCamera) {
      const outgoingTarget = this.cameraController.getTarget();
      const snapshot = captureCameraState(outgoingCamera, outgoingTarget);
      if (outgoingMode === 'graph') {
        this.graphCameraSnapshot = snapshot;
      } else {
        this.treeCameraSnapshot = snapshot;
      }
    }

    this.layoutMode = mode;
    this.layoutEngine = SceneController.createLayoutEngine(mode);

    if (this.nodeIdsByIndex.length === 0) return;

    const positions = this.computeActiveLayout();

    // The two render pipelines (sphere/line for graph, card/orthogonal
    // for tree) cannot share meshes. Tear down the inactive set and
    // build the active one. The label overlay is rebuilt by the build*
    // helpers so the labels always match the active style.
    if (mode === 'tree') {
      this.teardownGraphMeshes();
      this.labelRenderer.clear();
      this.applyTreeCamera();
      this.buildTreeMeshes(positions);
      // Carry the current filter through to the freshly-built tree
      // meshes so toggling modes preserves the visibility predicate.
      this.applyFilterMask();

      // 2. Restore the saved tree-mode camera if we have one; otherwise
      //    fall through to the first-entry default (frameToFit on the
      //    visible subset, then axis-align). The reset MUST run AFTER
      //    frameToFit: frameToFit's setTarget→placeCameraAtRadius
      //    preserves the prior eye direction, which on the graph→tree
      //    transition still carries residual X/Y components from the
      //    perspective camera. Resetting last guarantees the orthographic
      //    eye is purely along +Z relative to the freshly-framed tree
      //    centroid.
      if (this.treeCameraSnapshot && this.orthographicCamera) {
        applyCameraState(
          this.orthographicCamera,
          this.cameraController,
          this.treeCameraSnapshot,
        );
      } else {
        this.frameToFit(this.framingPositions(positions));
        this.cameraController.resetCameraOrientation();
      }
    } else {
      this.teardownTreeMeshes();
      this.labelRenderer.clear();
      this.applyGraphCamera();
      const edges = this.store.getAllEdges();
      this.buildGraphMeshes(edges, positions);
      // Carry the current filter through to the freshly-built graph
      // meshes so toggling modes preserves the visibility predicate.
      this.applyFilterMask();

      // 2. Restore the saved graph-mode camera if we have one; otherwise
      //    fall through to the first-entry default (frameToFit only —
      //    graph mode owns its free-rotation eye vector).
      if (this.graphCameraSnapshot && this.perspectiveCamera) {
        applyCameraState(
          this.perspectiveCamera,
          this.cameraController,
          this.graphCameraSnapshot,
        );
      } else {
        this.frameToFit(this.framingPositions(positions));
      }
    }
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
    // The HTML LabelRenderer is graph-mode only. Tree-mode labels live
    // inside the WebGL cards (rasterised by TreeNodeMesh) and are toggled
    // by rebuilding the cards, not by repopulating the overlay.
    if (show && this.layoutMode !== 'tree') {
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

    // Project labels. Tree mode renders its labels inside the WebGL cards
    // (CanvasTexture) so the HTML overlay stays empty there — projecting
    // it through the orthographic camera would otherwise collapse every
    // label to the screen origin.
    if (this.showLabels && this.layoutMode !== 'tree') this.projectLabels();
    // Annotations always project — they're host-driven so the overlay
    // shouldn't depend on the label setting. Projection works in both
    // graph (perspective) and tree (orthographic) modes since
    // `Vector3.project` is camera-type-agnostic.
    if (this.annotationRenderer.getCount() > 0) this.projectAnnotations();

    // Update hover state if pointer is over the canvas.
    if (this.enableHover && this.pointerActive) this.updateHover();

    // Sync the "+" affordance with the hovered node's screen position.
    // We project ONLY the hovered node, never every node in the graph,
    // so this is O(1) per frame regardless of graph size.
    if (this.hoveredIndex !== null) this.projectAffordance();
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

  /**
   * Project the world-space position of every annotated node into
   * screen space and push the result into the annotation renderer. The
   * AnnotationRenderer holds its own DOM elements; this method just
   * keeps their `transform: translate(...)` in sync with the camera.
   *
   * Projection works in both graph (perspective) and tree
   * (orthographic) modes — `Vector3.project` is camera-type-agnostic.
   *
   * Looks up positions from the layout engine for animated layouts and
   * the layout cache for static ones, mirroring {@link paintNode}.
   */
  private projectAnnotations(): void {
    if (!this.container) return;
    const camera = this.renderer.getCamera();
    if (!camera) return;

    const ids = this.annotationRenderer.getAnnotatedNodeIds();
    if (ids.length === 0) return;

    const positions = this.layoutEngine.animated
      ? this.layoutEngine.getPositions()
      : this.layoutCache.get(this.layoutMode);
    if (!positions || positions.size === 0) return;

    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    const halfW = width / 2;
    const halfH = height / 2;

    for (const id of ids) {
      const pos = positions.get(id);
      if (!pos) continue;
      this._projectVec.set(pos.x, pos.y, pos.z);
      this._projectVec.project(camera);
      const x = this._projectVec.x * halfW + halfW;
      const y = -this._projectVec.y * halfH + halfH;
      this.annotationRenderer.updatePosition(id, x, y);
    }
  }

  /**
   * Project the world-space position of the currently-hovered node
   * into screen space and push it into {@link ExpandAffordance.updatePosition}.
   * Called from {@link tick} only when {@link hoveredIndex} is non-null,
   * so this is O(1) per frame regardless of graph size.
   *
   * Mirrors {@link projectAnnotations} in shape (camera-agnostic
   * `Vector3.project`, layout-source selection by `animated`) but
   * targets exactly one node.
   */
  private projectAffordance(): void {
    if (!this.container) return;
    if (this.hoveredIndex === null) return;
    const camera = this.renderer.getCamera();
    if (!camera) return;

    const id = this.nodeIdsByIndex[this.hoveredIndex];
    if (!id) return;

    const positions = this.layoutEngine.animated
      ? this.layoutEngine.getPositions()
      : this.layoutCache.get(this.layoutMode);
    const pos = positions?.get(id);
    if (!pos) return;

    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    const halfW = width / 2;
    const halfH = height / 2;

    this._projectVec.set(pos.x, pos.y, pos.z);
    this._projectVec.project(camera);
    const x = this._projectVec.x * halfW + halfW;
    const y = -this._projectVec.y * halfH + halfH;
    this.expandAffordance.updatePosition(x, y);
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

  /**
   * Capture the pointerdown anchor + the node currently under the cursor
   * (if any). Used by `onPointerUp` to decide whether the gesture was a
   * click or a drag.
   *
   * Affordance clicks are routed through the affordance overlay's own
   * pointer handlers (the affordance has `pointer-events: auto` in CSS
   * while the node mesh container does not), so we don't see them here.
   */
  private onPointerDown(event: Event): void {
    if (!this.container) return;
    const me = event as MouseEvent;
    // Only react to primary button presses.
    if (me.button !== undefined && me.button !== 0) {
      this.pointerDown = null;
      return;
    }
    const rect = this.container.getBoundingClientRect();
    const x = me.clientX - rect.left;
    const y = me.clientY - rect.top;
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    const nodeId = this.raycaster.hitTest(x, y, width, height);
    this.pointerDown = { x, y, nodeId };
  }

  /**
   * Decide whether the gesture is a click (small drift, same node) and
   * fire the host-registered `onNodeClick` handler. Drags suppress the
   * click — without this guard, dragging the camera would always fire
   * a click on the start node.
   */
  private onPointerUp(event: Event): void {
    if (!this.container || !this.pointerDown) return;
    const anchor = this.pointerDown;
    this.pointerDown = null;
    if (!anchor.nodeId) return;
    if (!this.onNodeClick) return;

    const me = event as MouseEvent;
    const rect = this.container.getBoundingClientRect();
    const x = me.clientX - rect.left;
    const y = me.clientY - rect.top;
    const dx = x - anchor.x;
    const dy = y - anchor.y;
    const drift = Math.hypot(dx, dy);
    if (drift > SceneController.CLICK_DRIFT_THRESHOLD) return;

    // Confirm we're still over the same node (in case the user nudged the
    // mouse over to a neighbor mid-click).
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    const upNodeId = this.raycaster.hitTest(x, y, width, height);
    if (upNodeId !== anchor.nodeId) return;

    try {
      this.onNodeClick(anchor.nodeId);
    } catch (err) {
      // Host callbacks must not break the scene.
      // eslint-disable-next-line no-console
      console.warn('[InferaGraph SceneController] onNodeClick handler threw:', err);
    }
  }

  /**
   * Register the click handler for node bodies. Receives the canonical
   * NodeId. Pass `null` to clear. Distinct from
   * {@link setOnExpandRequest} which fires for "+" affordance clicks.
   */
  setOnNodeClick(handler: ((nodeId: string) => void) | null): void {
    this.onNodeClick = handler;
  }

  private updateHover(): void {
    if (!this.container) return;
    // Either the graph (sphere) or tree (card) node mesh must be live.
    if (!this.nodeMesh && !this.treeNodeMesh) return;

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
    // Reveal the "+" affordance for the newly-hovered node. Position
    // is pushed by `tick()` on the next frame via `updatePosition`.
    this.expandAffordance.show(this.nodeIdsByIndex[newIndex]);
  }

  private clearHover(): void {
    if (this.hoveredIndex !== null) {
      this.paintNode(this.hoveredIndex, /* hovered */ false);
      this.hoveredIndex = null;
    }
    this.tooltipOverlay.hide();
    this.expandAffordance.hide();
  }

  private paintNode(index: number, hovered: boolean): void {
    const node = this.nodesByIndex[index];
    if (!node) return;

    // Pick the right position source for the active layout type.
    //
    // Animated layouts (e.g. {@link ForceLayout3D}, `animated === true`):
    // the engine ticks every frame and the live positions live on the
    // engine instance — `layoutCache` only holds the INITIAL `compute()`
    // snapshot and is never updated as physics evolves. Reading from the
    // cache during a hover would snap the node back to its initial
    // position for a single frame before the next physics tick restored
    // the live position — a visible flicker (bug 0.1.24 fixes).
    //
    // Static layouts (e.g. {@link TreeLayout}, `animated === false`):
    // positions are settled at compute time and never change. On a
    // round-trip into the same static mode (graph → tree → graph → tree)
    // `computeActiveLayout` short-circuits on a cache hit and the freshly
    // constructed engine's internal `positions` map stays empty — so the
    // engine is NOT a valid source here. The cache is the source of truth
    // (bug 0.1.19's original fix, preserved).
    const positions = this.layoutEngine.animated
      ? this.layoutEngine.getPositions()
      : this.layoutCache.get(this.layoutMode);
    const id = this.nodeIdsByIndex[index];
    const pos = positions?.get(id) ?? { x: 0, y: 0, z: 0 };

    const color = hovered
      ? this.colorResolver.resolveHover(node)
      : this.baseColorsByIndex[index] ?? this.colorResolver.resolve(node);

    if (this.nodeMesh) {
      // updateInstance writes both matrix + colour; keep matrix unchanged by
      // re-using the current position. Reset scale to the resting radius so
      // a hovered node doesn't inherit a mid-pulse size.
      this.nodeMesh.updateInstance(index, pos, color, this.nodeMesh.getRadius());
    }
    if (this.treeNodeMesh) {
      // Tree-view cards repaint by tinting the outline. Position is
      // unchanged — the tree layout is static.
      this.treeNodeMesh.updateCard(id, pos, color);
    }
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
   * Replace the domain-agnostic visibility predicate. The same predicate
   * is dispatched to every mounted mesh via the internal
   * `VisibilityHost` contract — graph nodes / graph edges / tree cards /
   * tree connectors / any future visualization mode — so a single call
   * here updates every active layout uniformly.
   *
   * Filter changes are applied as in-place visibility toggles on the
   * existing GPU buffers. There is **no** mesh teardown, **no** mesh
   * rebuild, and **no** layout recompute. Hidden nodes keep their
   * positions; toggling them back on restores the prior frame
   * instantly.
   *
   * Pass `undefined` to clear the filter (everyone visible).
   */
  setFilter(predicate: ((node: NodeData) => boolean) | undefined): void {
    this.nodeFilter = predicate ?? (() => true);
    this.recomputeVisibility();
    this.applyFilterMask();

    // A filter change genuinely changes which nodes are visible, so the
    // camera should reframe on the visible subset. Without this, when
    // both `layout` and `filter` props change in the same React render
    // (e.g. graph→tree on the Bible Graph app) the layout effect runs
    // first against stale visibility and the tree shifts off-screen.
    //
    // This is a camera move only — `applyFilterMask` already pushed the
    // new visibility to the GPU; nothing is rebuilt or recomputed here.
    //
    // `applyFilterMask` is also called from `buildGraphMeshes` /
    // `buildTreeMeshes` / `syncFromStore` / `setLayout`, all of which
    // already call `frameToFit` themselves — so the reframe lives at
    // the `setFilter` entry point only, never inside `applyFilterMask`.
    //
    // Edge case: if `setFilter` is called before any layout has been
    // computed (e.g. constructor-time predicate before
    // `syncFromStore`), the layout cache is empty and `getPositions`
    // returns nothing meaningful. Skip the reframe in that case — the
    // eventual `syncFromStore` will frame correctly using the
    // now-correct `visibleNodeIds`.
    if (this.nodeIdsByIndex.length === 0) return;
    const positions = this.layoutEngine.animated
      ? this.layoutEngine.getPositions()
      : this.layoutCache.get(this.layoutMode);
    if (positions && positions.size > 0) {
      this.frameToFit(this.framingPositions(positions));
    }
  }

  /** Active visibility predicate (for tests + introspection). */
  getFilter(): (node: NodeData) => boolean {
    return this.nodeFilter;
  }

  /**
   * Recompute the cached `visibleNodeIds` + `visibleEdgeIds` from the
   * active predicate. Edges are visible iff BOTH of their endpoints
   * pass the node predicate — there is no separate edge predicate, by
   * design. Cheap: O(N + E) with no allocations beyond the two output
   * sets.
   */
  private recomputeVisibility(): void {
    const visibleNodes = new Set<string>();
    for (let i = 0; i < this.nodeIdsByIndex.length; i++) {
      if (this.nodeFilter(this.nodesByIndex[i])) {
        visibleNodes.add(this.nodeIdsByIndex[i]);
      }
    }
    const visibleEdges = new Set<string>();
    for (let i = 0; i < this.edgeIdsByIndex.length; i++) {
      const ep = this.edgeEndpoints[i];
      if (visibleNodes.has(ep.sourceId) && visibleNodes.has(ep.targetId)) {
        visibleEdges.add(this.edgeIdsByIndex[i]);
      }
    }
    this.visibleNodeIds = visibleNodes;
    this.visibleEdgeIds = visibleEdges;
  }

  /**
   * Dispatch the cached visibility id sets to every currently-mounted
   * mesh via the uniform `VisibilityHost.setVisibility` interface. This
   * is the single chokepoint where mesh-level visibility is updated;
   * adding a new visualization mode (geospatial / timeline / chord /
   * etc.) means writing a new mesh class that implements
   * `VisibilityHost`, mounting it via the existing `addObject` flow,
   * and adding ONE line here — the public prop surface and the
   * dispatch logic do not change.
   *
   * Tree-edge meshes consume `visibleNodeIds` (tree edges are derived
   * from node visibility); everything else consumes the appropriate
   * domain set.
   */
  private applyFilterMask(): void {
    this.nodeMesh?.setVisibility(this.visibleNodeIds);
    this.edgeMesh?.setVisibility(this.visibleEdgeIds);
    this.treeNodeMesh?.setVisibility(this.visibleNodeIds);
    this.treeEdgeMesh?.setVisibility(this.visibleNodeIds);
    // HTML label overlay must follow the same predicate. Without this,
    // graph-mode labels stayed in the DOM with `display: ''` even when
    // their owning instance was hidden via per-instance alpha.
    this.labelRenderer.setVisibility(this.visibleNodeIds);
    // Visibility may have shadowed a previously-set highlight (e.g. a
    // mode toggle rebuilds the meshes); re-dispatch it so the freshly
    // built buffers carry the active highlight.
    this.applyHighlightMask();
  }

  /**
   * Replace the active highlight set. Same uniform-dispatch contract as
   * {@link setFilter}: every mounted mesh class implementing
   * {@link HighlightHost} receives the new set, regardless of viz mode.
   * An empty set restores baseline (no dim).
   *
   * Highlight composes with visibility — a hidden node stays hidden
   * even when "highlighted." This is intentional: visibility is the
   * stronger constraint.
   */
  setHighlight(ids: ReadonlySet<string>): void {
    this.highlightIds = new Set(ids);
    this.applyHighlightMask();
  }

  /** Active highlight set (for tests + introspection). */
  getHighlight(): ReadonlySet<string> {
    return this.highlightIds;
  }

  /**
   * Dispatch the cached highlight set to every mounted mesh class
   * implementing {@link HighlightHost}. Mirror of
   * {@link applyFilterMask}.
   */
  private applyHighlightMask(): void {
    this.nodeMesh?.setHighlight(this.highlightIds);
    this.edgeMesh?.setHighlight(this.highlightIds);
    this.treeNodeMesh?.setHighlight(this.highlightIds);
    this.treeEdgeMesh?.setHighlight(this.highlightIds);
  }

  /**
   * Replace the rendered set of inferred edges and dispatch them to
   * the {@link InferredEdgeMesh}. Caches the input so a subsequent
   * graph-mode rebuild (after a tree-mode round-trip) can replay
   * them without the host re-pushing.
   *
   * Tree mode is a deliberate no-op in v1 per the Phase 5 plan
   * (tree-mode dashed edges deferred to Phase 6). The cache is still
   * updated so a later `setLayout('graph')` re-entry replays the
   * latest edges + visibility.
   *
   * Implements {@link InferredEdgeHost.setInferredEdges}.
   */
  setInferredEdges(
    edges: ReadonlyArray<InferredEdge>,
    positions: ReadonlyMap<string, Vector3>,
  ): void {
    // Snapshot the input so the cache doesn't alias caller-mutable
    // state. We only need a shallow copy — `InferredEdge` is `readonly`
    // by contract.
    this.lastInferredEdges = edges.slice();

    if (this.layoutMode !== 'graph') {
      // eslint-disable-next-line no-console
      console.debug(
        '[SceneController] setInferredEdges in tree mode is a no-op (overlay deferred to Phase 6); cached for graph-mode replay.',
      );
      return;
    }

    this.inferredEdgeMesh?.setInferredEdges(edges, positions);
    // Adding a freshly-allocated mesh (the InferredEdgeMesh disposes
    // and rebuilds on every setInferredEdges call) — re-register it
    // on the renderer so the new geometry is part of the scene.
    if (this.inferredEdgeMesh) {
      const overlayMesh = this.inferredEdgeMesh.getMesh();
      if (overlayMesh) {
        this.renderer.addObject('__inferred_edges__', overlayMesh);
      } else {
        // Empty edge set — make sure the previous mesh, if any, is
        // off the scene graph.
        this.renderer.removeObject('__inferred_edges__');
      }
    }
  }

  /**
   * Toggle inferred-edge overlay visibility. Caches the state so a
   * later graph-mode rebuild (after a tree-mode round-trip) replays
   * it onto the freshly-built mesh.
   *
   * Tree mode is a deliberate no-op in v1 per the Phase 5 plan; the
   * cache still updates so a later graph-mode re-entry honours the
   * latest visibility intent.
   *
   * Implements {@link InferredEdgeHost.setInferredEdgeVisibility}.
   */
  setInferredEdgeVisibility(visible: boolean): void {
    this.inferredEdgesVisible = visible;

    if (this.layoutMode !== 'graph') {
      // eslint-disable-next-line no-console
      console.debug(
        '[SceneController] setInferredEdgeVisibility in tree mode is a no-op (overlay deferred to Phase 6); cached for graph-mode replay.',
      );
      return;
    }

    this.inferredEdgeMesh?.setVisibility(visible);
  }

  /** Active inferred-edge overlay visibility (for tests + introspection). */
  getInferredEdgeVisibility(): boolean {
    return this.inferredEdgesVisible;
  }

  /**
   * Snapshot of the most recently dispatched inferred-edge set
   * (cache only — not the buffer contents). Useful for tests + for
   * inspecting "what's been pushed" without going through the mesh.
   */
  getInferredEdges(): ReadonlyArray<InferredEdge> {
    return this.lastInferredEdges;
  }

  /**
   * The active inferred-edge mesh (graph mode only). Exposed for
   * tests + advanced consumers that need to drive the overlay
   * directly. Returns `null` in tree mode or before
   * {@link buildGraphMeshes} has run.
   */
  getInferredEdgeMesh(): InferredEdgeMesh | null {
    return this.inferredEdgeMesh;
  }

  /**
   * Animate the camera to focus on `nodeId`. Looks up the node's
   * position from the active layout (live for animated layouts, cached
   * for static layouts) and hands it to
   * {@link CameraController.focusOn}.
   *
   * No-op when the node is unknown or no layout has run yet.
   */
  focusOn(nodeId: string): void {
    const idx = this.nodeIdsByIndex.indexOf(nodeId);
    if (idx < 0) return;
    const positions = this.layoutEngine.animated
      ? this.layoutEngine.getPositions()
      : this.layoutCache.get(this.layoutMode);
    const pos = positions?.get(nodeId);
    if (!pos) return;
    this.cameraController.focusOn(pos);
  }

  /**
   * Attach a callout to a node via the {@link AnnotationRenderer}. Same
   * uniform-dispatch pattern as the other tool-call sinks.
   */
  annotate(nodeId: string, text: string): void {
    this.annotationRenderer.annotate(nodeId, text);
  }

  /**
   * Clear the callout(s) on a node, or all callouts when `nodeId` is
   * omitted.
   */
  clearAnnotations(nodeId?: string): void {
    this.annotationRenderer.clearAnnotations(nodeId);
  }

  /** The annotation renderer (exposed for tests + advanced consumers). */
  getAnnotationRenderer(): AnnotationRenderer {
    return this.annotationRenderer;
  }

  /** The "+" hover affordance (exposed for tests + advanced consumers). */
  getExpandAffordance(): ExpandAffordance {
    return this.expandAffordance;
  }

  /**
   * Register the click handler for the "+" affordance. The handler
   * receives the node id of the affordance that was clicked. The
   * React layer wires this to its neighbor-expansion dispatch
   * (`useInferaGraphNeighbors().expand`).
   *
   * Pass `null` to clear the handler.
   */
  setOnExpandRequest(handler: ((nodeId: string) => void) | null): void {
    this.onExpandRequest = handler;
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
    // Only the perspective camera carries a FOV — orthographic cameras don't,
    // so we fall back to a sensible default. The frame-to-fit math still
    // produces a reasonable orbit distance for either projection because
    // `cameraController.setRadius` ultimately controls the placement.
    const persp = camera instanceof THREE.PerspectiveCamera ? camera : null;
    const fovDeg =
      persp && typeof persp.fov === 'number' && Number.isFinite(persp.fov)
        ? persp.fov
        : 60;
    const halfFov = ((fovDeg * Math.PI) / 180) / 2;
    const fillFactor = 0.8;
    const framedRadius = Math.max(p95, 1);
    const distance = (framedRadius / Math.tan(halfFov)) / fillFactor;
    const radius = Math.max(80, distance);

    this.cameraController.setTarget({ x: cx, y: cy, z: cz });
    this.cameraController.setRadius(radius);

    // Axis-alignment for tree mode is owned by the FIRST-ENTRY default
    // path in `setLayout` / `syncFromStore`, which calls
    // `resetCameraOrientation` BEFORE this method. On subsequent entries
    // to tree mode the saved snapshot's eye vector is restored without
    // a frameToFit, so we never want this method to mutate orientation.
    // Graph mode keeps its free-rotation eye vector untouched as well.
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
