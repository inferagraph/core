import type { NodeId, EdgeData } from '../types.js';
import { joinNatural } from './joinNatural.js';

/**
 * Configuration for how edge types map to human-readable descriptions.
 * The key is the edge type (e.g., 'father_of'), the value is the description
 * template from the target's perspective (e.g., 'Son of').
 *
 * Edge types that share the same label will be grouped together.
 */
export type EdgeLabelMap = Record<string, string>;

export interface AggregatedEdge {
  /** The human-readable label (e.g., "Son of") */
  label: string;
  /** The names of the related nodes, joined naturally */
  names: string[];
  /** The formatted description (e.g., "Son of Abraham and Sarah") */
  description: string;
}

/**
 * Aggregate edges for a node into grouped descriptions.
 *
 * @param nodeId - The node to describe
 * @param edges - All edges in the graph
 * @param getNodeName - Function to look up a node's display name by ID
 * @param incomingLabels - Map of edge types to labels when the node is the TARGET
 *                         (e.g., { father_of: 'Son of', mother_of: 'Son of' })
 * @param outgoingLabels - Map of edge types to labels when the node is the SOURCE
 *                         (e.g., { father_of: 'Father of', mother_of: 'Mother of' })
 * @returns Aggregated edge descriptions
 *
 * @example
 * // Isaac has incoming father_of from Abraham, incoming mother_of from Sarah
 * // Isaac has outgoing father_of to Jacob, outgoing father_of to Esau
 * aggregateEdges('isaac', edges, getName,
 *   { father_of: 'Son of', mother_of: 'Son of' },
 *   { father_of: 'Father of' }
 * )
 * // Returns:
 * // [
 * //   { label: 'Son of', names: ['Abraham', 'Sarah'], description: 'Son of Abraham and Sarah' },
 * //   { label: 'Father of', names: ['Jacob', 'Esau'], description: 'Father of Jacob and Esau' },
 * // ]
 */
export function aggregateEdges(
  nodeId: NodeId,
  edges: EdgeData[],
  getNodeName: (id: NodeId) => string,
  incomingLabels?: EdgeLabelMap,
  outgoingLabels?: EdgeLabelMap,
): AggregatedEdge[] {
  // Each bucket dedupes by related node ID so that a consumer mapping both
  // directions of a bidirectional edge to the same display label (e.g.,
  // father_of and son_of both → 'Son of') does not emit duplicate names.
  const groups = new Map<string, { seen: Set<NodeId>; names: string[] }>();

  const addToGroup = (label: string, relatedId: NodeId): void => {
    let bucket = groups.get(label);
    if (!bucket) {
      bucket = { seen: new Set<NodeId>(), names: [] };
      groups.set(label, bucket);
    }
    if (bucket.seen.has(relatedId)) return;
    bucket.seen.add(relatedId);
    bucket.names.push(getNodeName(relatedId));
  };

  for (const edge of edges) {
    const edgeType = (edge.attributes.type as string) ?? '';

    if (edge.targetId === nodeId && incomingLabels?.[edgeType]) {
      // This edge points TO our node
      addToGroup(incomingLabels[edgeType], edge.sourceId);
    }

    if (edge.sourceId === nodeId && outgoingLabels?.[edgeType]) {
      // This edge points FROM our node
      addToGroup(outgoingLabels[edgeType], edge.targetId);
    }
  }

  const result: AggregatedEdge[] = [];
  for (const [label, { names }] of groups) {
    result.push({
      label,
      names,
      description: `${label} ${joinNatural(names)}`,
    });
  }

  return result;
}
