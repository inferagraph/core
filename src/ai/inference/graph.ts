import type { NodeId } from '../../types.js';
import type { GraphStore } from '../../store/GraphStore.js';

/**
 * Tunables for {@link computeGraphInferences}.
 *
 * The defaults are chosen for the seed-scale graphs Phase 5 v1 targets
 * (≤ ~50 nodes). Larger graphs can lower {@link limitPerNode} to keep the
 * candidate set bounded.
 */
export interface GraphInferenceOptions {
  /**
   * Minimum shared neighbors required for the `common_neighbor` and
   * `jaccard` signals to fire. Default `1`.
   */
  minCommonNeighbors?: number;
  /**
   * Maximum candidate pairs emitted per source node. Higher-scored pairs
   * win when more would be produced. Default `10`.
   */
  limitPerNode?: number;
  /**
   * Decay factor applied to each additional hop in the transitive-closure
   * signal. A pair two hops apart scores `decay^2`, three hops `decay^3`,
   * etc. Default `0.5`.
   */
  transitiveDecay?: number;
}

/** Which sub-algorithm produced this candidate. Useful for debugging / UI. */
export type GraphInferenceSignal =
  | 'common_neighbor'
  | 'jaccard'
  | 'structural_cosine'
  | 'transitive';

/**
 * One pair-scored candidate the graph signals produced. Multiple candidates
 * may exist for the same `(sourceId, targetId)` pair across different
 * signals — the merger deduplicates them.
 */
export interface GraphInferenceCandidate {
  sourceId: NodeId;
  targetId: NodeId;
  /**
   * Composite score in `[0, 1]`. Each signal normalises to `[0, 1]` before
   * we emit; the merger may further re-rank but the per-signal score is
   * already comparable across signals.
   */
  score: number;
  /** Which sub-algorithm produced this candidate. */
  signal: GraphInferenceSignal;
}

/**
 * Compute pure-graph inferred edges from a {@link GraphStore}.
 *
 * Runs four sub-algorithms over the store's adjacency:
 *
 * 1. **Common-neighbor**: pairs `(u, v)` with `≥ minCommonNeighbors` shared
 *    neighbors. Score = `shared / max(deg(u), deg(v))` (so higher-degree hubs
 *    don't dominate small-graph signals).
 * 2. **Jaccard**: same pairs as common-neighbor, scored as
 *    `|N(u) ∩ N(v)| / |N(u) ∪ N(v)|`.
 * 3. **Structural cosine**: `|N(u) ∩ N(v)| / sqrt(|N(u)| * |N(v)|)`.
 * 4. **Decayed transitive closure**: for each pair `(u, v)` reachable via a
 *    path of length `k ∈ {2, 3}`, score `decay^(k-1)`. Length 1 is excluded
 *    (those are already explicit edges).
 *
 * The function returns ALL candidates from every signal. Same `(u, v)` pair
 * may appear up to four times (once per signal); deduplication is the
 * merger's job. Self-pairs (`u === v`) are never emitted.
 *
 * Per `limitPerNode`, each source node keeps at most that many candidates
 * across all signals combined (top-scored pairs win). Isolated nodes
 * (degree 0) contribute nothing.
 *
 * Domain-agnostic: only operates on opaque {@link NodeId}. No attribute
 * inspection, no edge-type assumptions.
 */
export function computeGraphInferences(
  store: GraphStore,
  opts?: GraphInferenceOptions,
): GraphInferenceCandidate[] {
  const minCommon = opts?.minCommonNeighbors ?? 1;
  const limitPerNode = opts?.limitPerNode ?? 10;
  const decay = opts?.transitiveDecay ?? 0.5;

  const nodes = store.getAllNodes();
  if (nodes.length < 2) return [];

  // Pre-compute neighbor sets once so we don't re-walk adjacency for every
  // pair-wise comparison. Empty set on isolated nodes — they contribute
  // nothing to common-neighbor / Jaccard / cosine.
  const neighbors = new Map<NodeId, Set<NodeId>>();
  for (const node of nodes) {
    neighbors.set(node.id, new Set(store.getNeighborIds(node.id)));
  }

  const out: GraphInferenceCandidate[] = [];

  // -- Pairwise signals (common neighbor / Jaccard / cosine) ---------------
  for (let i = 0; i < nodes.length; i++) {
    const u = nodes[i].id;
    const nu = neighbors.get(u)!;
    if (nu.size === 0) continue;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const v = nodes[j].id;
      const nv = neighbors.get(v)!;
      if (nv.size === 0) continue;

      const shared = countIntersection(nu, nv);
      if (shared < minCommon) continue;

      const maxDeg = Math.max(nu.size, nv.size);
      const cnScore = maxDeg === 0 ? 0 : shared / maxDeg;
      const unionSize = nu.size + nv.size - shared;
      const jaccard = unionSize === 0 ? 0 : shared / unionSize;
      const cosine = Math.sqrt(nu.size * nv.size) === 0
        ? 0
        : shared / Math.sqrt(nu.size * nv.size);

      out.push({ sourceId: u, targetId: v, score: cnScore, signal: 'common_neighbor' });
      out.push({ sourceId: u, targetId: v, score: jaccard, signal: 'jaccard' });
      out.push({ sourceId: u, targetId: v, score: cosine, signal: 'structural_cosine' });
    }
  }

  // -- Transitive closure (length 2 + length 3) ----------------------------
  // For length 2: for each u, its 2-hop set = union over neighbors-of-neighbors
  // minus u itself and minus 1-hop neighbors. Score = decay^1.
  // For length 3: 3-hop set minus 1-hop, 2-hop, self. Score = decay^2.
  //
  // We compute these via BFS up to depth 3 per source. N is small in v1
  // (~50 nodes) so the O(N * |edges|) scan is fine; a future optimization
  // could memoise or use matrix multiplication.
  for (const node of nodes) {
    const u = node.id;
    if (neighbors.get(u)!.size === 0) continue;
    const distances = bfsDistances(u, neighbors, 3);
    for (const [v, dist] of distances) {
      if (v === u) continue;
      if (dist < 2) continue;
      const score = Math.pow(decay, dist - 1);
      if (score <= 0) continue;
      out.push({ sourceId: u, targetId: v, score, signal: 'transitive' });
    }
  }

  // -- Apply per-source-node cap ------------------------------------------
  // For each source node, collapse candidates by best score per signal*pair,
  // then keep top `limitPerNode` candidates by score.
  return capPerSource(out, limitPerNode);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function countIntersection(a: Set<NodeId>, b: Set<NodeId>): number {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  let count = 0;
  for (const x of smaller) if (larger.has(x)) count += 1;
  return count;
}

function bfsDistances(
  start: NodeId,
  neighbors: Map<NodeId, Set<NodeId>>,
  maxDepth: number,
): Map<NodeId, number> {
  const dist = new Map<NodeId, number>();
  dist.set(start, 0);
  let frontier: NodeId[] = [start];
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: NodeId[] = [];
    for (const u of frontier) {
      for (const v of neighbors.get(u) ?? new Set<NodeId>()) {
        if (dist.has(v)) continue;
        dist.set(v, depth + 1);
        next.push(v);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return dist;
}

function capPerSource(
  candidates: GraphInferenceCandidate[],
  limitPerNode: number,
): GraphInferenceCandidate[] {
  if (limitPerNode <= 0) return [];
  const bySource = new Map<NodeId, GraphInferenceCandidate[]>();
  for (const c of candidates) {
    let list = bySource.get(c.sourceId);
    if (!list) {
      list = [];
      bySource.set(c.sourceId, list);
    }
    list.push(c);
  }
  const out: GraphInferenceCandidate[] = [];
  for (const list of bySource.values()) {
    list.sort((a, b) => b.score - a.score);
    for (let i = 0; i < Math.min(list.length, limitPerNode); i++) {
      out.push(list[i]);
    }
  }
  return out;
}
