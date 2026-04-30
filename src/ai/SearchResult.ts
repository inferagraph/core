import type { NodeId } from '../types.js';

/**
 * One hit returned by {@link AIEngine.search}.
 *
 * Auto-detected query routing fills `matchedField` differently per path:
 *   - **keyword**: the attribute key that matched (e.g. `'name'`,
 *     `'aliases'`). Mirrors the data-layer `SearchEngine` semantics.
 *   - **semantic**: omitted (similarity isn't tied to a single field).
 *
 * Hosts that need the legacy `{ matches: string[] }` shape should call the
 * data-layer `SearchEngine` directly — `AIEngine.search` is the one canonical
 * search surface for hosts integrating via `<InferaGraph>` and intentionally
 * normalizes both routing paths into this single shape.
 */
export interface SearchResult {
  nodeId: NodeId;
  /**
   * Similarity / relevance score. Scale is path-dependent:
   *   - keyword: integer (sum of attribute priority bonuses).
   *   - semantic: cosine similarity in [-1, 1].
   * Cross-path comparison is NOT meaningful; consumers usually take the top-K
   * from a single call and don't merge across calls.
   */
  score: number;
  /** Attribute key that matched (keyword path only). Omitted for semantic hits. */
  matchedField?: string;
}
