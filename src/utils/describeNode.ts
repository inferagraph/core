import type { GraphStore } from '../store/GraphStore.js';
import type { NodeId, NodeData, EdgeData } from '../types.js';
import { aggregateEdges, type EdgeLabelMap } from './aggregateEdges.js';

/**
 * Display options for {@link describeNode}.
 *
 * `incomingLabels` / `outgoingLabels` follow the same shape as
 * {@link aggregateEdges}: a map keyed by the edge's `attributes.type` whose
 * value is the human-readable phrase. When both maps are omitted the helper
 * falls back to a deterministic `Title Case` of the edge type, taking the
 * outgoing direction by default and the incoming direction (with a leading
 * `← `) only as a fallback. The default is intentionally minimal; the host
 * application supplies the real semantics (e.g. `father_of` → `Son of`).
 */
export interface DescribeNodeOptions {
  /** Map of edge type → label when the node is the TARGET of the edge. */
  incomingLabels?: EdgeLabelMap;
  /** Map of edge type → label when the node is the SOURCE of the edge. */
  outgoingLabels?: EdgeLabelMap;
  /**
   * Optional override for the title line. Defaults to the first non-empty
   * value of `attributes.title`, `attributes.name`, `attributes.label`, then
   * the node id.
   */
  getTitle?: (node: NodeData) => string;
  /**
   * Optional override for how a related node is displayed in a description
   * line. Defaults to the same name resolution used for the title.
   */
  getName?: (node: NodeData) => string;
}

/**
 * Result of describing a node — a title plus a list of natural-language
 * relationship lines suitable for tooltip / detail-panel rendering.
 */
export interface NodeDescription {
  /** Human-readable title (e.g. "Isaac"). */
  title: string;
  /**
   * Ordered relationship lines (e.g. `["Son of Abraham and Sarah", "Father of Jacob and Esau"]`).
   * Empty when the node has no outgoing/incoming edges that match the label maps.
   */
  lines: string[];
}

const TITLE_KEYS = ['title', 'name', 'label'] as const;

function defaultGetName(node: NodeData): string {
  const attrs = node.attributes ?? {};
  for (const key of TITLE_KEYS) {
    const value = (attrs as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return node.id;
}

function titleCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Produce a natural-language description of a node, joining its relationships
 * into prose like `"Son of Abraham and Sarah"` / `"Father of Jacob and Esau"`.
 *
 * The helper is domain-agnostic: it expects the consumer to supply
 * `incomingLabels` / `outgoingLabels` maps that translate raw edge types
 * (e.g. `father_of`) into the phrasing the consumer wants. Without those
 * maps the helper falls back to a deterministic `Title Case` of the edge
 * type so the tooltip is still readable for un-mapped relationships.
 *
 * @example
 * // With explicit maps:
 * describeNode(store, 'isaac', {
 *   incomingLabels: { father_of: 'Son of', mother_of: 'Son of' },
 *   outgoingLabels: { father_of: 'Father of' },
 * });
 * // → { title: 'Isaac', lines: ['Son of Abraham and Sarah', 'Father of Jacob and Esau'] }
 *
 * @example
 * // No maps — falls back to title-cased edge types:
 * describeNode(store, 'isaac');
 * // → { title: 'Isaac', lines: ['Father Of Jacob and Esau', '← Father Of Abraham', '← Mother Of Sarah'] }
 */
export function describeNode(
  store: GraphStore,
  nodeId: NodeId,
  options: DescribeNodeOptions = {},
): NodeDescription {
  const node = store.getNode(nodeId);
  if (!node) return { title: nodeId, lines: [] };

  const nodeData: NodeData = { id: node.id, attributes: node.attributes };
  const getTitle = options.getTitle ?? defaultGetName;
  const getName = options.getName ?? defaultGetName;
  const title = getTitle(nodeData);

  const edgeRecords = store.getEdgesForNode(nodeId);
  if (edgeRecords.length === 0) {
    return { title, lines: [] };
  }

  const edges: EdgeData[] = edgeRecords.map((e) => ({
    id: e.id,
    sourceId: e.sourceId,
    targetId: e.targetId,
    attributes: e.attributes,
  }));

  const lookupName = (id: NodeId): string => {
    const target = store.getNode(id);
    if (!target) return id;
    return getName({ id: target.id, attributes: target.attributes });
  };

  if (options.incomingLabels || options.outgoingLabels) {
    const aggregated = aggregateEdges(
      nodeId,
      edges,
      lookupName,
      options.incomingLabels,
      options.outgoingLabels,
    );
    return { title, lines: aggregated.map((a) => a.description) };
  }

  // Fallback: derive labels from the edge type via title-case. Outgoing
  // edges keep the type label as-is; incoming edges are prefixed with "← "
  // so the direction is unambiguous when both directions share a type.
  const seenTypes = new Set<string>();
  const incomingFallback: EdgeLabelMap = {};
  const outgoingFallback: EdgeLabelMap = {};
  for (const edge of edges) {
    const type = (edge.attributes as { type?: unknown }).type;
    if (typeof type !== 'string' || type.length === 0) continue;
    if (seenTypes.has(type)) continue;
    seenTypes.add(type);
    const cased = titleCase(type);
    incomingFallback[type] = `← ${cased}`;
    outgoingFallback[type] = cased;
  }
  const aggregated = aggregateEdges(
    nodeId,
    edges,
    lookupName,
    incomingFallback,
    outgoingFallback,
  );
  return { title, lines: aggregated.map((a) => a.description) };
}
