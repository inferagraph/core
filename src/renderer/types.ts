/**
 * Internal renderer-layer contracts shared by every visualization mesh
 * class. Pulled out of the SceneController + individual mesh files so a
 * new layout (geospatial, timeline, chord, etc.) can implement them
 * without circular imports.
 */

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
 *
 * Future extension: a `setHighlight(focusIds)` companion method will be
 * added to this interface when search highlighting lands. The same
 * uniform-dispatch pattern from the SceneController will apply.
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
