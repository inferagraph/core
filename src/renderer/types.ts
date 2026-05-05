/**
 * Internal renderer-layer contracts shared by every visualization mesh
 * class. Pulled out of the SceneController + individual mesh files so a
 * new layout (geospatial, timeline, chord, etc.) can implement them
 * without circular imports.
 */

import type { NodeId, Vector3 } from '../types.js';
import type { InferredEdge } from '../ai/InferredEdge.js';

/**
 * Toggle per-element visibility on a mesh class WITHOUT teardown,
 * rebuild, or layout recompute.
 *
 * Implementations differ in mechanism:
 *   - {@link NodeMesh} flips the alpha channel of `instanceColor`.
 *   - {@link EdgeMesh} flips alpha on both endpoints of each line segment
 *     in the vertex-colour buffer.
 *   - {@link TreeNodeMesh} flips `group.visible` on each per-node card.
 *   - {@link TreeEdgeMesh} flips alpha on each connector segment based on
 *     whether BOTH of its endpoint nodes are visible (so the predicate
 *     here is keyed by NODE id, not edge id — see the docstring on the
 *     concrete method).
 *
 * Contract:
 *   - Calling `setVisibility` MUST NOT dispose, rebuild, or reallocate
 *     any geometry, material, or per-instance buffer. Visibility is
 *     applied as an in-place mutation of an existing GPU buffer (alpha,
 *     `Object3D.visible`, etc.).
 *   - Implementations may assume the mesh has been built — callers
 *     either build before calling, or treat a pre-build call as a no-op.
 *   - The same `Set<string>` instance is passed to every mesh on a given
 *     filter change; implementations must NOT mutate it.
 */
export interface VisibilityHost {
  /**
   * Show the elements whose ids appear in `visibleIds`; hide the rest.
   * `NodeId` and `EdgeId` are both `string`, and the same `Set` instance
   * may be reused across mesh classes — each mesh interprets the ids in
   * its own domain (graph nodes vs. graph edges vs. tree cards vs. tree
   * connectors).
   */
  setVisibility(visibleIds: ReadonlySet<string>): void;
}

/**
 * Emphasize a subset of elements; non-matching elements dim. Same uniform
 * dispatch pattern as {@link VisibilityHost} — the SceneController
 * computes the highlight set once and pushes it to every mounted mesh
 * via this contract, regardless of mode (graph / tree / future
 * geospatial / timeline / chord / etc.).
 *
 * Mechanism varies per mode:
 *   - {@link NodeMesh} drops alpha on non-highlighted instances to ~0.3.
 *   - {@link EdgeMesh} drops alpha on edges that don't connect two
 *     highlighted endpoints.
 *   - {@link TreeNodeMesh} multiplies fill / outline opacity on
 *     non-highlighted cards.
 *   - {@link TreeEdgeMesh} dims connectors whose endpoints aren't both
 *     highlighted.
 *
 * Contract:
 *   - An empty set MUST restore the baseline (no dimming). This makes
 *     "clear highlight" trivial for hosts.
 *   - Highlight composes with visibility: a hidden node stays hidden;
 *     highlight only applies to elements that are currently visible.
 *   - Calling `setHighlight` MUST NOT dispose, rebuild, or reallocate
 *     any geometry / material / per-instance buffer.
 */
export interface HighlightHost {
  /**
   * Emphasize the elements whose ids appear in `highlightIds`. Non-
   * matching elements dim. An empty set restores all elements to
   * baseline (no dim).
   */
  setHighlight(highlightIds: ReadonlySet<string>): void;
}

/**
 * Camera-facing contract for "focus on a node" tool calls. Implemented
 * by {@link SceneController} (the only camera owner in the system) and
 * by future viz modes that have a richer notion of focus (e.g. a
 * geospatial mode might pan AND tilt).
 *
 * Contract:
 *   - The animation MUST be cancellable — calling `focusOn` again before
 *     a previous animation completes retargets smoothly.
 *   - The implementation owns the easing + duration. Hosts cannot
 *     specify them.
 *   - When the target nodeId is not currently visible, implementations
 *     SHOULD still attempt to frame whatever position they have for it
 *     (dim though it may be) — the LLM may have asked the user to
 *     "focus on Adam" while a filter hides Adam, and snapping to the
 *     hidden position is more useful than silently doing nothing.
 */
export interface FocusHost {
  /** Animate the camera to focus on a single node by id. */
  focusOn(nodeId: string): void;
}

/**
 * HTML-overlay contract for callout / sticky-note annotations attached
 * to nodes. Implemented by {@link AnnotationRenderer} and dispatched
 * uniformly by {@link SceneController} regardless of viz mode.
 *
 * Contract:
 *   - Multiple annotations on the same node are allowed; calling
 *     `annotate(id, text)` twice with different text creates two
 *     callouts. Hosts that want single-callout-per-node should call
 *     `clearAnnotations(id)` first.
 *   - `clearAnnotations()` with no id clears EVERY annotation across
 *     all nodes — convenience for full-reset.
 *   - The renderer is responsible for tracking world→screen positions
 *     each frame and updating the DOM elements; the contract is
 *     deliberately minimal.
 */
export interface AnnotateHost {
  /** Attach a callout with the given text to the node. */
  annotate(nodeId: string, text: string): void;
  /** Clear annotations for one node (or all when nodeId is omitted). */
  clearAnnotations(nodeId?: string): void;
}

/**
 * Inferred-edge overlay contract. Implemented by {@link SceneController}
 * (graph mode dispatches to {@link InferredEdgeMesh}; tree mode is a
 * deliberate no-op in v1 — Phase 6 territory).
 *
 * Inferred edges are an *overlay* concept layered on top of the explicit
 * graph: they are rendered as dashed, dimmer lines that the host can show
 * or hide at will. The renderer never mutates the GraphStore; the edge set
 * arrives via {@link setInferredEdges} from the AI inference pipeline.
 *
 * Same uniform-dispatch pattern as {@link VisibilityHost} /
 * {@link HighlightHost}: the SceneController forwards calls to whichever
 * mesh classes are mounted in the active mode. A future tree-mode
 * implementation just adds a tree-edge inferred mesh and a single line
 * to the dispatch helper.
 *
 * Contract:
 *   - {@link setInferredEdges} REPLACES the entire stored edge set.
 *     Hosts that incrementally accumulate inferences must merge before
 *     calling.
 *   - {@link setInferredEdgeVisibility} toggles the overlay's visibility
 *     WITHOUT teardown or rebuild. Hidden state is the v1 default
 *     (`showInferredEdges` defaults to `false` on the React prop).
 *   - The `positions` map mirrors the layout positions of the graph's
 *     explicit nodes — the same map already passed to
 *     `updateInstance`/`updateSegment`. The inferred-edge renderer does
 *     not own positions; it consumes them.
 *   - Calling either method while no inferred-edge mesh exists (e.g.
 *     before {@link SceneController.attach}, or in tree mode) is a
 *     well-defined no-op.
 */
export interface InferredEdgeHost {
  /**
   * Replace the rendered set of inferred edges. The implementation
   * (re)builds the underlying line geometry to fit `edges.length` and
   * uses `positions` to look up each endpoint's world-space coordinate.
   *
   * Edges whose `sourceId` or `targetId` is missing from `positions`
   * are dropped silently — the explicit-edge dedup in the merger should
   * have removed them, but the renderer is defensive.
   */
  setInferredEdges(
    edges: ReadonlyArray<InferredEdge>,
    positions: ReadonlyMap<NodeId, Vector3>,
  ): void;
  /**
   * Toggle the inferred-edge overlay's visibility. `false` hides the
   * overlay entirely without disposing geometry; `true` reveals it.
   * Default state on a freshly built mesh is `false` (hidden).
   */
  setInferredEdgeVisibility(visible: boolean): void;
}
