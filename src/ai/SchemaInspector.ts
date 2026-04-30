import type { NodeData, NodeAttributes } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';

/** Inferred type label for an attribute. `mixed` = multiple primitive types observed. */
export type SchemaAttributeType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null'
  | 'mixed';

/**
 * Per-attribute schema summary. `cardinality` counts distinct primitive
 * values seen (arrays expand into their elements). `samples` is a bounded
 * cross-section used for both LLM-prompt construction AND embedding-text
 * rendering — it must be deterministic across runs (insertion order).
 */
export interface SchemaAttribute {
  /** Attribute key as it appears in `node.attributes`. */
  key: string;
  /** Inferred type label. `mixed` indicates more than one primitive type seen. */
  type: SchemaAttributeType;
  /** Number of nodes that carry this attribute (regardless of value). */
  presentIn: number;
  /** Distinct primitive values observed (across array unwrapping). */
  cardinality: number;
  /**
   * Bounded sample of distinct primitive values, in insertion order. Used
   * verbatim by the LLM-prompt builder; ordering must be deterministic so
   * cache keys stay stable.
   */
  samples: string[];
}

/**
 * Aggregate schema for every observed attribute key in the store.
 * Iteration order is insertion order (first key seen, first listed).
 */
export interface SchemaSummary {
  /** Total number of nodes scanned. */
  nodeCount: number;
  /** Per-attribute summaries, keyed by attribute name. Iterable in insertion order. */
  attributes: Map<string, SchemaAttribute>;
}

/**
 * Configuration for {@link SchemaInspector}. All bounds are per-attribute
 * unless documented otherwise.
 */
export interface SchemaInspectorConfig {
  /** Maximum sample values to retain per attribute. Default 10. */
  maxSamplesPerAttribute?: number;
  /** Hard upper-bound on nodes scanned for sampling. Default Infinity (whole store). */
  maxNodesScanned?: number;
}

/**
 * Discover schema + render embedding text from the store.
 *
 * Replaces the tiny attribute-discovery in Phase 1's AIEngine. Two roles:
 *   1. **LLM prompt construction**: `summary()` exposes attribute keys +
 *      sample values for the filter / chat prompt builders.
 *   2. **Embedding text**: `embeddingTextFor(node)` produces a deterministic
 *      string ("title + structured render of attributes") that downstream
 *      `provider.embed` calls turn into vectors. Two nodes with the same
 *      attributes always produce the same string, which is what the
 *      `contentHash` cache-buster relies on.
 */
export class SchemaInspector {
  private readonly store: GraphStore;
  private readonly maxSamplesPerAttribute: number;
  private readonly maxNodesScanned: number;
  private cached: SchemaSummary | undefined;

  constructor(store: GraphStore, config?: SchemaInspectorConfig) {
    this.store = store;
    this.maxSamplesPerAttribute = config?.maxSamplesPerAttribute ?? 10;
    this.maxNodesScanned =
      config?.maxNodesScanned !== undefined ? config.maxNodesScanned : Infinity;
  }

  /**
   * Recompute the schema summary, ignoring any previous cache. Called by
   * AIEngine before every prompt build so we always see the latest data.
   */
  summary(): SchemaSummary {
    const nodes = this.store.getAllNodes();
    const limit = Math.min(nodes.length, this.maxNodesScanned);
    const attributes = new Map<string, SchemaAttribute>();
    // Track the FULL distinct-value set per attribute internally (for
    // cardinality), but only KEEP the first N as samples in the bucket.
    const seenValues = new Map<string, Set<string>>();
    const observedTypes = new Map<string, Set<SchemaAttributeType>>();

    for (let i = 0; i < limit; i++) {
      const node = nodes[i];
      for (const [key, value] of Object.entries(node.attributes)) {
        let bucket = attributes.get(key);
        if (!bucket) {
          bucket = {
            key,
            type: 'string',
            presentIn: 0,
            cardinality: 0,
            samples: [],
          };
          attributes.set(key, bucket);
          seenValues.set(key, new Set());
          observedTypes.set(key, new Set());
        }
        bucket.presentIn += 1;
        const typeSet = observedTypes.get(key)!;
        const valueSet = seenValues.get(key)!;
        for (const t of detectTypes(value)) typeSet.add(t);
        for (const sample of summarizeValue(value)) {
          if (!valueSet.has(sample)) {
            valueSet.add(sample);
            if (bucket.samples.length < this.maxSamplesPerAttribute) {
              bucket.samples.push(sample);
            }
          }
        }
      }
    }

    for (const [key, bucket] of attributes) {
      const types = observedTypes.get(key)!;
      bucket.type = collapseTypes(types);
      bucket.cardinality = seenValues.get(key)!.size;
    }

    const summary: SchemaSummary = {
      nodeCount: limit,
      attributes,
    };
    this.cached = summary;
    return summary;
  }

  /**
   * Last-computed summary, or compute one if none exists. Used by callers
   * that want to share a schema pass across multiple operations within the
   * same logical request.
   */
  cachedSummary(): SchemaSummary {
    return this.cached ?? this.summary();
  }

  /** Drop any cached summary so the next call recomputes. */
  invalidate(): void {
    this.cached = undefined;
  }

  /**
   * Render a deterministic embedding-text for a node. Format:
   *
   *   `<title>\n<key>: <value>\n<key>: <value>...`
   *
   * Where `<title>` is the first present `name`, `title`, or `label`
   * attribute (falling back to the node id), and the remaining attributes
   * are listed in **alphabetical key order** so two nodes with the same
   * attributes always produce the same string regardless of insertion
   * order. Array attributes are joined with `, `.
   *
   * Hosts that need a different format can override per-call by passing a
   * pre-built string to a downstream `provider.embed`; this helper is the
   * default the AIEngine uses when warming the cache.
   */
  embeddingTextFor(node: NodeData): string {
    return embeddingText(node);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function detectTypes(value: unknown): SchemaAttributeType[] {
  if (value === null) return ['null'];
  if (Array.isArray(value)) return ['array'];
  switch (typeof value) {
    case 'string':
      return ['string'];
    case 'number':
      return ['number'];
    case 'boolean':
      return ['boolean'];
    case 'object':
      return ['object'];
    default:
      return [];
  }
}

function collapseTypes(types: Set<SchemaAttributeType>): SchemaAttributeType {
  if (types.size === 0) return 'null';
  if (types.size === 1) {
    return types.values().next().value as SchemaAttributeType;
  }
  // null + something is still that something (the attribute is just
  // sometimes-undefined). null + null + ... is just null.
  const withoutNull = new Set(types);
  withoutNull.delete('null');
  if (withoutNull.size === 1) {
    return withoutNull.values().next().value as SchemaAttributeType;
  }
  return 'mixed';
}

function summarizeValue(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      if (typeof item === 'string') out.push(item);
      else if (typeof item === 'number' || typeof item === 'boolean') out.push(String(item));
    }
    return out;
  }
  return [];
}

/**
 * Module-level pure version of the embedding-text renderer. Exposed so
 * tests + downstream consumers can call it without instantiating an
 * inspector.
 */
export function embeddingText(node: NodeData): string {
  const attrs = node.attributes ?? {};
  const title = pickTitle(attrs) ?? node.id;
  const lines: string[] = [title];
  const keys = Object.keys(attrs).sort();
  for (const key of keys) {
    if (key === 'name' || key === 'title' || key === 'label') continue;
    const rendered = renderValue(attrs[key]);
    if (rendered === undefined) continue;
    lines.push(`${key}: ${rendered}`);
  }
  return lines.join('\n');
}

function pickTitle(attrs: NodeAttributes): string | undefined {
  for (const key of ['name', 'title', 'label']) {
    const v = attrs[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function renderValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (typeof item === 'string' && item.length > 0) parts.push(item);
      else if (typeof item === 'number' || typeof item === 'boolean') parts.push(String(item));
    }
    return parts.length > 0 ? parts.join(', ') : undefined;
  }
  // Plain objects: stable JSON for determinism. Skip Maps / Dates / etc.
  if (typeof value === 'object' && value.constructor === Object) {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
