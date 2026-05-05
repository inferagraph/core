import type { NodeId } from '../../types.js';
import type { GraphStore } from '../../store/GraphStore.js';
import type { InferredEdge, InferredEdgeSource } from '../InferredEdge.js';
import type { GraphInferenceCandidate } from './graph.js';
import type { EmbeddingInferenceCandidate } from './embedding.js';
import type { LLMInferenceCandidate } from './llm.js';

/** Tunables for {@link mergeInferences}. */
export interface MergeOptions {
  /**
   * Reciprocal-rank-fusion smoothing constant. Higher values give more
   * weight to deep ranks (small differences late in the list). The
   * Cormack & Lynam original recommends `60` and we keep that as the
   * default. Pass a different value only if you have specific reasons.
   */
  rrfK?: number;
  /**
   * When `true` (default + recommended), pairs that already exist as an
   * explicit edge in `store` are dropped from the merged output. The check
   * runs in BOTH directions: if `(a, b)` or `(b, a)` is an explicit edge,
   * neither candidate ordering survives.
   *
   * The prototype found that disabling this filter produces ~80% noise on
   * seed-scale graphs (the algorithms re-discover the explicit
   * sibling/spouse/parent edges they were meant to surface as INFERRED).
   * The default exists for a reason.
   */
  excludeExplicit?: boolean;
}

/**
 * Fuse the three signal lists into a single ranked {@link InferredEdge} list.
 *
 * Process:
 *
 * 1. **Per-source dedup**: each list is grouped by ordered `(sourceId,
 *    targetId)` and the best entry per pair survives within that signal.
 * 2. **Per-source ranking**: 1-based rank assigned by descending raw score,
 *    ties broken by deterministic order.
 * 3. **Reciprocal rank fusion**: combined score
 *    `Σ_signals 1 / (k + rank_signal)` over the signals that fired for a pair.
 * 4. **Explicit-edge filter**: pairs whose either-direction equivalent
 *    already exists in `store` are dropped (when `excludeExplicit` is true).
 * 5. **Type selection**: the LLM-emitted type wins when present; otherwise
 *    `'related_to'`.
 * 6. **Reasoning attachment**: only attached when the LLM source contributed.
 * 7. **Score normalisation**: RRF scores compressed to `[0, 1]` by dividing
 *    by the maximum theoretical score `Σ 1 / (k + 1)` for `n_signals` lists.
 *
 * Output is sorted by descending fused score.
 */
export function mergeInferences(
  store: GraphStore,
  graph: ReadonlyArray<GraphInferenceCandidate>,
  embedding: ReadonlyArray<EmbeddingInferenceCandidate>,
  llm: ReadonlyArray<LLMInferenceCandidate>,
  opts?: MergeOptions,
): InferredEdge[] {
  const k = opts?.rrfK ?? 60;
  const excludeExplicit = opts?.excludeExplicit ?? true;

  const explicit = excludeExplicit ? collectExplicitPairs(store) : new Set<string>();

  // Per-signal: collapse to best raw score per (source,target).
  const graphRanked = rankSignal(graph.map((c) => ({ key: pairKey(c.sourceId, c.targetId), source: c.sourceId, target: c.targetId, raw: c.score })));
  const embedRanked = rankSignal(embedding.map((c) => ({ key: pairKey(c.sourceId, c.targetId), source: c.sourceId, target: c.targetId, raw: c.score })));
  const llmRanked = rankSignal(
    llm.map((c) => ({
      key: pairKey(c.sourceId, c.targetId),
      source: c.sourceId,
      target: c.targetId,
      raw: c.confidence,
    })),
  );

  // Map original LLM candidates by key so we can recover `type`/`reasoning`
  // at the end.
  const llmMeta = new Map<string, LLMInferenceCandidate>();
  for (const c of llm) {
    const key = pairKey(c.sourceId, c.targetId);
    const prev = llmMeta.get(key);
    // Highest-confidence variant wins if duplicates appear.
    if (!prev || c.confidence > prev.confidence) llmMeta.set(key, c);
  }

  // Collect every key seen across signals.
  const allKeys = new Set<string>();
  for (const k of graphRanked.keys()) allKeys.add(k);
  for (const k of embedRanked.keys()) allKeys.add(k);
  for (const k of llmRanked.keys()) allKeys.add(k);

  const fused: InferredEdge[] = [];

  for (const key of allKeys) {
    const g = graphRanked.get(key);
    const e = embedRanked.get(key);
    const l = llmRanked.get(key);

    let source: NodeId | undefined;
    let target: NodeId | undefined;
    if (g) {
      source = g.source;
      target = g.target;
    } else if (e) {
      source = e.source;
      target = e.target;
    } else if (l) {
      source = l.source;
      target = l.target;
    }
    if (!source || !target) continue;

    if (excludeExplicit && (explicit.has(pairKey(source, target)) || explicit.has(pairKey(target, source)))) {
      continue;
    }

    const sources: InferredEdgeSource[] = [];
    if (g) sources.push('graph');
    if (e) sources.push('embedding');
    if (l) sources.push('llm');
    if (sources.length === 0) continue;

    let rrf = 0;
    if (g) rrf += 1 / (k + g.rank);
    if (e) rrf += 1 / (k + e.rank);
    if (l) rrf += 1 / (k + l.rank);

    // Normalize to [0, 1]: max theoretical RRF when ALL three signals rank
    // this pair first. We divide so single-signal pairs land near 1/3 and
    // triple-signal pairs near 1.0.
    const maxRrf = 3 * (1 / (k + 1));
    const score = clamp01(rrf / maxRrf);

    const meta = l ? llmMeta.get(key) : undefined;
    const type = meta?.type ?? 'related_to';
    const reasoning = meta?.reasoning;

    const perSource: {
      graph?: { rank: number; raw: number };
      embedding?: { rank: number; raw: number };
      llm?: { rank: number; raw: number };
    } = {};
    if (g) perSource.graph = { rank: g.rank, raw: g.raw };
    if (e) perSource.embedding = { rank: e.rank, raw: e.raw };
    if (l) perSource.llm = { rank: l.rank, raw: l.raw };

    fused.push({
      sourceId: source,
      targetId: target,
      type,
      score,
      sources,
      reasoning,
      perSource,
    });
  }

  fused.sort((a, b) => b.score - a.score);
  return fused;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RankedEntry {
  source: NodeId;
  target: NodeId;
  rank: number;
  raw: number;
}

function rankSignal(
  items: ReadonlyArray<{ key: string; source: NodeId; target: NodeId; raw: number }>,
): Map<string, RankedEntry> {
  // Collapse duplicates: best raw score per key.
  const best = new Map<string, { source: NodeId; target: NodeId; raw: number }>();
  for (const it of items) {
    const prev = best.get(it.key);
    if (!prev || it.raw > prev.raw) {
      best.set(it.key, { source: it.source, target: it.target, raw: it.raw });
    }
  }
  // Sort by raw desc; assign 1-based ranks. Tie-break on key for determinism.
  const sorted = [...best.entries()].sort((a, b) => {
    const dr = b[1].raw - a[1].raw;
    if (dr !== 0) return dr;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  const out = new Map<string, RankedEntry>();
  let rank = 1;
  for (const [key, val] of sorted) {
    out.set(key, { source: val.source, target: val.target, rank, raw: val.raw });
    rank += 1;
  }
  return out;
}

function collectExplicitPairs(store: GraphStore): Set<string> {
  const out = new Set<string>();
  for (const edge of store.getAllEdges()) {
    out.add(pairKey(edge.sourceId, edge.targetId));
  }
  return out;
}

function pairKey(source: NodeId, target: NodeId): string {
  return `${escapePipe(source)}|${escapePipe(target)}`;
}

function escapePipe(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
