import type { NodeId } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { QueryEngine } from '../store/QueryEngine.js';

export interface ContextBuilderConfig {
  /** Attribute key to use as the node's display name */
  nameKey: string;
  /** Attribute key to use as the node's type/category label */
  typeKey: string;
  /** Additional attribute keys to include in context output */
  contextKeys: string[];
  /** Attribute key for long-form content */
  contentKey: string;
  /** Attribute keys to use when matching query text to nodes */
  searchKeys: string[];
}

export class ContextBuilder {
  private config: ContextBuilderConfig;

  constructor(
    private readonly store: GraphStore,
    _queryEngine: QueryEngine,
    config?: Partial<ContextBuilderConfig>,
  ) {
    this.config = {
      nameKey: config?.nameKey ?? 'name',
      typeKey: config?.typeKey ?? 'type',
      contextKeys: config?.contextKeys ?? ['era', 'tags'],
      contentKey: config?.contentKey ?? 'content',
      searchKeys: config?.searchKeys ?? ['name', 'aliases', 'content'],
    };
  }

  configure(config: Partial<ContextBuilderConfig>): void {
    Object.assign(this.config, config);
  }

  buildContext(nodeIds: NodeId[]): string {
    const lines: string[] = [];

    for (const id of nodeIds) {
      const node = this.store.getNode(id);
      if (!node) continue;

      const name = node.attributes[this.config.nameKey];
      const type = node.attributes[this.config.typeKey];
      lines.push(`## ${name} (${type})`);

      for (const key of this.config.contextKeys) {
        const value = node.attributes[key];
        if (value == null) continue;
        if (Array.isArray(value) && value.length > 0) {
          lines.push(`${key}: ${value.join(', ')}`);
        } else if (!Array.isArray(value)) {
          lines.push(`${key}: ${value}`);
        }
      }

      const edges = this.store.getEdgesForNode(id);
      for (const edge of edges) {
        const otherId = edge.sourceId === id ? edge.targetId : edge.sourceId;
        const other = this.store.getNode(otherId);
        if (other) {
          lines.push(`- ${edge.attributes.type} → ${other.attributes[this.config.nameKey]}`);
        }
      }

      const content = node.attributes[this.config.contentKey];
      if (content) lines.push(`\n${content}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  buildContextForQuery(query: string): string {
    const allNodes = this.store.getAllNodes();
    const lowerQuery = query.toLowerCase();

    const relevant = allNodes.filter((node) => {
      for (const key of this.config.searchKeys) {
        const value = node.attributes[key];
        if (value == null) continue;

        if (typeof value === 'string') {
          if (value.toLowerCase().includes(lowerQuery)) return true;
        } else if (Array.isArray(value)) {
          if (
            value.some(
              (element) =>
                typeof element === 'string' &&
                element.toLowerCase().includes(lowerQuery),
            )
          ) {
            return true;
          }
        }
      }
      return false;
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
