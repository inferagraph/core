import type { NodeId } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { QueryEngine } from '../store/QueryEngine.js';

export class ContextBuilder {
  constructor(
    private readonly store: GraphStore,
    private readonly queryEngine: QueryEngine,
  ) {}

  buildContext(nodeIds: NodeId[]): string {
    const lines: string[] = [];

    for (const id of nodeIds) {
      const node = this.store.getNode(id);
      if (!node) continue;

      const { name, type, era, tags, content } = node.attributes;
      lines.push(`## ${name} (${type})`);
      if (era) lines.push(`Era: ${era}`);
      if (tags?.length) lines.push(`Tags: ${tags.join(', ')}`);

      const edges = this.store.getEdgesForNode(id);
      for (const edge of edges) {
        const otherId = edge.sourceId === id ? edge.targetId : edge.sourceId;
        const other = this.store.getNode(otherId);
        if (other) {
          lines.push(`- ${edge.attributes.type} → ${other.attributes.name}`);
        }
      }

      if (content) lines.push(`\n${content}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  buildContextForQuery(query: string): string {
    const allNodes = this.store.getAllNodes();
    const relevant = allNodes.filter((node) => {
      const lowerQuery = query.toLowerCase();
      const { name, aliases, content } = node.attributes;
      return (
        name.toLowerCase().includes(lowerQuery) ||
        aliases?.some((a) => a.toLowerCase().includes(lowerQuery)) ||
        content?.toLowerCase().includes(lowerQuery)
      );
    });

    const nodeIds = relevant.map((n) => n.id);
    const expanded = new Set(nodeIds);

    for (const id of nodeIds) {
      for (const neighborId of this.store.getNeighborIds(id)) {
        expanded.add(neighborId);
      }
    }

    return this.buildContext([...expanded]);
  }
}
