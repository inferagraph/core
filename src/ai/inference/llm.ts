import type { NodeData, NodeId } from '../../types.js';
import type { GraphStore } from '../../store/GraphStore.js';
import type { CacheProvider } from '../../cache/lruCache.js';
import type { LLMProvider } from '../LLMProvider.js';
import { SchemaInspector, type SchemaSummary } from '../SchemaInspector.js';

/**
 * Inputs to {@link computeLLMInferences}. Mirrors the surface AIEngine
 * passes through — the caller chooses neighborhood depth, candidate cap,
 * and provides any cancellation signal.
 */
export interface LLMInferenceContext {
  /** The graph being analysed. Used for source enumeration + target validation. */
  store: GraphStore;
  /** LLM provider. We call `provider.complete()` once per source node. */
  provider: LLMProvider;
  /** Schema inspector — supplies the domain-blind prompt block. */
  inspector: SchemaInspector;
  /**
   * Maximum number of distinct attribute samples to render in the prompt
   * schema block. Mirrors AIEngine's `schemaSampleSize` so token usage stays
   * bounded across calls.
   */
  schemaSampleSize: number;
  /**
   * How far out to walk the graph when collecting the candidate target list
   * for each source node. `1` = direct neighbors only; `2` = up to two-hop.
   * Default `1`.
   */
  neighborhoodDepth?: number;
  /**
   * Maximum number of candidate edges the LLM may emit per source node.
   * The prompt asks for the top-K propositions; downstream the merger
   * ranks across sources via RRF. Default `5`.
   */
  limitPerNode?: number;
  /**
   * Optional response cache. When present, identical `(model, prompt)` pairs
   * skip the LLM round-trip on subsequent calls. The cache is the same
   * {@link CacheProvider} AIEngine passes around for its other operations.
   */
  cache?: CacheProvider;
  /** Cancellation signal. When aborted, returns whatever's been collected. */
  signal?: AbortSignal;
}

/**
 * One LLM-extracted relationship candidate.
 *
 * The `type` is opaque — the LLM is encouraged to pick a verb the schema
 * already uses, but `core` does not validate against any closed enum.
 *
 * `confidence` is the model's self-rated confidence in `[0, 1]`. The merger
 * uses ranks (not raw scores) for fusion, but the value is preserved on the
 * final {@link InferredEdge.perSource} for downstream UI.
 */
export interface LLMInferenceCandidate {
  sourceId: NodeId;
  targetId: NodeId;
  type: string;
  reasoning?: string;
  confidence: number;
}

/**
 * Run a one-shot LLM extraction per node and return a flat list of
 * candidate inferred edges.
 *
 * Per node we:
 *   1. Gather the per-node candidate target list (neighbors + 2-hop reach,
 *      bounded so the prompt stays small).
 *   2. Build a domain-blind prompt via the schema summary.
 *   3. Call `provider.complete(prompt, { format: 'json' })`.
 *   4. Parse JSON. Drop any candidate whose `targetId` doesn't exist in
 *      `store` (hallucination).
 *
 * Hallucinated target IDs are dropped silently per-node and surfaced as a
 * single `console.warn` summary at the end. Malformed JSON for a single
 * node is also dropped silently.
 *
 * Domain-agnostic: the prompt is built solely from
 * {@link SchemaInspector.summary} — no hardcoded vocabulary.
 */
export async function computeLLMInferences(
  ctx: LLMInferenceContext,
): Promise<LLMInferenceCandidate[]> {
  const limitPerNode = ctx.limitPerNode ?? 5;
  const neighborhoodDepth = ctx.neighborhoodDepth ?? 1;
  if (limitPerNode <= 0) return [];
  if (ctx.signal?.aborted) return [];

  const nodes = ctx.store.getAllNodes();
  if (nodes.length < 2) return [];

  const schemaSummary = ctx.inspector.summary();
  const out: LLMInferenceCandidate[] = [];
  let droppedHallucinations = 0;

  for (const sourceNode of nodes) {
    if (ctx.signal?.aborted) break;
    const candidates = collectCandidates(
      ctx.store,
      sourceNode.id,
      neighborhoodDepth,
    );
    if (candidates.length === 0) continue;

    const nodeData: NodeData = {
      id: sourceNode.id,
      attributes: sourceNode.attributes,
    };
    const prompt = buildLLMInferencePrompt(
      nodeData,
      candidates,
      schemaSummary,
      ctx.schemaSampleSize,
      limitPerNode,
    );

    let raw: string | undefined;
    if (ctx.cache) {
      const cached = await ctx.cache.get(cacheKeyFor(ctx.provider.name, prompt));
      if (cached !== undefined) raw = cached;
    }
    if (raw === undefined) {
      try {
        raw = await ctx.provider.complete(prompt, { format: 'json' });
      } catch {
        // Provider failure for one node — skip it; the rest of the graph
        // still contributes.
        continue;
      }
      if (ctx.cache) {
        try {
          await ctx.cache.set(cacheKeyFor(ctx.provider.name, prompt), raw);
        } catch {
          // Cache failures must never break inference.
        }
      }
    }

    const parsed = parseLLMResponse(raw);
    if (!parsed) continue;

    let kept = 0;
    for (const cand of parsed) {
      if (kept >= limitPerNode) break;
      if (typeof cand.targetId !== 'string' || cand.targetId.length === 0) continue;
      if (cand.targetId === sourceNode.id) continue;
      if (!ctx.store.hasNode(cand.targetId)) {
        droppedHallucinations += 1;
        continue;
      }
      const type =
        typeof cand.type === 'string' && cand.type.length > 0
          ? cand.type
          : 'related_to';
      const confidence = clamp01(cand.confidence);
      out.push({
        sourceId: sourceNode.id,
        targetId: cand.targetId,
        type,
        reasoning:
          typeof cand.reasoning === 'string' && cand.reasoning.length > 0
            ? cand.reasoning
            : undefined,
        confidence,
      });
      kept += 1;
    }
  }

  if (droppedHallucinations > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[InferaGraph] dropped ${droppedHallucinations} hallucinated target ID${
        droppedHallucinations === 1 ? '' : 's'
      } from llm inference`,
    );
  }

  return out;
}

/**
 * Build the schema-aware prompt the LLM receives for ONE source node.
 *
 * Exported for tests so the domain-blind grep test can assert nothing
 * leaks domain vocabulary into the prompt over a generic fixture.
 */
export function buildLLMInferencePrompt(
  node: NodeData,
  candidates: ReadonlyArray<{ id: string; title: string }>,
  schemaSummary: SchemaSummary,
  schemaSampleSize: number,
  limitPerNode: number,
): string {
  const schemaBlock = renderSchemaBlock(schemaSummary, schemaSampleSize);
  const sourceTitle = pickTitle(node) ?? node.id;
  const candidateBlock = candidates
    .map((c) => `- id="${c.id}" title="${c.title}"`)
    .join('\n');
  const sourceAttrs = renderNodeAttributes(node);

  return [
    'You are extracting plausible relationships between entities in a knowledge graph.',
    '',
    'Dataset schema (attribute keys and a sample of observed values):',
    schemaBlock,
    '',
    `Source node: id="${node.id}" title="${sourceTitle}"`,
    sourceAttrs,
    '',
    'Candidate target nodes (from the source\'s graph neighborhood):',
    candidateBlock,
    '',
    'Task:',
    `- Propose up to ${limitPerNode} relationships from the source to candidates above.`,
    '- Use a relationship "type" verb that fits the schema vocabulary observed above.',
    '- Output JSON only — no prose, no code fences. Schema:',
    '  {"edges":[{"targetId":"...","type":"...","reasoning":"...","confidence":0.0}]}',
    '- Use ONLY targetId values from the candidate list above.',
    '- confidence is a number in [0, 1].',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RawLLMEdge {
  targetId?: unknown;
  type?: unknown;
  reasoning?: unknown;
  confidence?: unknown;
}

function parseLLMResponse(raw: string): RawLLMEdge[] | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const obj = parsed as { edges?: unknown };
  // Accept top-level array shape too: `[ { ... } ]`.
  const list = Array.isArray(parsed) ? parsed : Array.isArray(obj.edges) ? obj.edges : undefined;
  if (!list) return undefined;
  const out: RawLLMEdge[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    out.push(item as RawLLMEdge);
  }
  return out;
}

function collectCandidates(
  store: GraphStore,
  sourceId: NodeId,
  depth: number,
): { id: string; title: string }[] {
  const seen = new Set<NodeId>([sourceId]);
  let frontier: NodeId[] = [sourceId];
  const collected: NodeId[] = [];
  for (let d = 0; d < Math.max(1, depth); d++) {
    const next: NodeId[] = [];
    for (const u of frontier) {
      for (const v of store.getNeighborIds(u)) {
        if (seen.has(v)) continue;
        seen.add(v);
        next.push(v);
        collected.push(v);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  // If the source has no neighbors at all, fall back to a small slice of
  // arbitrary other nodes so the LLM has SOMETHING to choose from. This
  // matches the v1 spec — isolated nodes still get one inference pass.
  if (collected.length === 0) {
    for (const node of store.getAllNodes()) {
      if (node.id !== sourceId) collected.push(node.id);
      if (collected.length >= 20) break;
    }
  }
  return collected.map((id) => ({
    id,
    title: pickTitleFromStore(store, id),
  }));
}

function pickTitleFromStore(store: GraphStore, id: NodeId): string {
  const node = store.getNode(id);
  if (!node) return id;
  return pickTitle({ id, attributes: node.attributes }) ?? id;
}

function pickTitle(node: NodeData): string | undefined {
  for (const key of ['name', 'title', 'label']) {
    const v = node.attributes?.[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function renderNodeAttributes(node: NodeData): string {
  const attrs = node.attributes ?? {};
  const lines: string[] = ['Source attributes:'];
  const keys = Object.keys(attrs).sort();
  for (const key of keys) {
    const v = attrs[key];
    if (v == null) continue;
    if (typeof v === 'string') {
      lines.push(`- ${key}: ${v}`);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`- ${key}: ${String(v)}`);
    } else if (Array.isArray(v)) {
      const parts: string[] = [];
      for (const item of v) {
        if (typeof item === 'string') parts.push(item);
        else if (typeof item === 'number' || typeof item === 'boolean') {
          parts.push(String(item));
        }
      }
      if (parts.length > 0) lines.push(`- ${key}: ${parts.join(', ')}`);
    }
  }
  return lines.join('\n');
}

function renderSchemaBlock(schema: SchemaSummary, sampleSize: number): string {
  const lines: string[] = [];
  for (const [key, attr] of schema.attributes) {
    const samples = attr.samples.slice(0, sampleSize);
    lines.push(`- ${key}: ${samples.join(', ')}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(no attributes)';
}

function clamp01(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function cacheKeyFor(providerName: string, prompt: string): string {
  return `llmInference|${providerName}|${prompt.length}|${fastHash(prompt)}`;
}

/** Cheap stable hash for cache keys. Same shape as AIEngine.fnv1a64 but local. */
function fastHash(input: string): string {
  let hi = 0xcbf29ce4 | 0;
  let lo = 0x84222325 | 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    lo = (lo ^ code) >>> 0;
    const PRIME_HI = 0x100;
    const PRIME_LO = 0x000001b3;
    const loMul = Math.imul(lo, PRIME_LO);
    const hiMul = Math.imul(hi, PRIME_LO) + Math.imul(lo, PRIME_HI);
    lo = loMul >>> 0;
    hi = (hiMul + ((loMul / 0x100000000) | 0)) >>> 0;
  }
  return ((hi >>> 0).toString(16).padStart(8, '0')) + ((lo >>> 0).toString(16).padStart(8, '0'));
}
