import type { NodeId } from '../types.js';
import type { Node } from './Node.js';

export interface IndexerConfig {
  /** Attribute keys to index. Each creates a Map<value, Set<NodeId>> index */
  indexKeys: string[];
  /** Attribute key to use as unique name index (Map<value, NodeId>) */
  nameKey?: string;
}

export class Indexer {
  private config: IndexerConfig;
  private indexes = new Map<string, Map<string, Set<NodeId>>>();
  private nameIndex = new Map<string, NodeId>();

  constructor(config?: Partial<IndexerConfig>) {
    this.config = {
      indexKeys: config?.indexKeys ?? ['type', 'tags'],
      nameKey: config?.nameKey ?? 'name',
    };
    this.initializeIndexes();
  }

  configure(config: Partial<IndexerConfig>): void {
    Object.assign(this.config, config);
    this.initializeIndexes();
  }

  private initializeIndexes(): void {
    for (const key of this.config.indexKeys) {
      if (!this.indexes.has(key)) {
        this.indexes.set(key, new Map());
      }
    }
  }

  addNode(node: Node): void {
    // Index each configured key
    for (const key of this.config.indexKeys) {
      const value = node.attributes[key];
      if (value == null) continue;

      const index = this.indexes.get(key)!;

      if (Array.isArray(value)) {
        for (const element of value) {
          const strVal = String(element);
          if (!index.has(strVal)) {
            index.set(strVal, new Set());
          }
          index.get(strVal)!.add(node.id);
        }
      } else {
        const strVal = String(value);
        if (!index.has(strVal)) {
          index.set(strVal, new Set());
        }
        index.get(strVal)!.add(node.id);
      }
    }

    // Name index
    if (this.config.nameKey) {
      const nameValue = node.attributes[this.config.nameKey];
      if (typeof nameValue === 'string') {
        this.nameIndex.set(nameValue.toLowerCase(), node.id);
      }
    }
  }

  removeNode(node: Node): void {
    // Remove from each configured index
    for (const key of this.config.indexKeys) {
      const value = node.attributes[key];
      if (value == null) continue;

      const index = this.indexes.get(key);
      if (!index) continue;

      if (Array.isArray(value)) {
        for (const element of value) {
          index.get(String(element))?.delete(node.id);
        }
      } else {
        index.get(String(value))?.delete(node.id);
      }
    }

    // Remove from name index
    if (this.config.nameKey) {
      const nameValue = node.attributes[this.config.nameKey];
      if (typeof nameValue === 'string') {
        this.nameIndex.delete(nameValue.toLowerCase());
      }
    }
  }

  /** Generic get-by-attribute-value */
  getByAttribute(key: string, value: string): Set<NodeId> {
    return this.indexes.get(key)?.get(value) ?? new Set();
  }

  /** Convenience: get by 'type' attribute */
  getByType(type: string): Set<NodeId> {
    return this.getByAttribute('type', type);
  }

  /** Convenience: get by 'tags' attribute */
  getByTag(tag: string): Set<NodeId> {
    return this.getByAttribute('tags', tag);
  }

  /** Get node ID by name (uses the configured nameKey) */
  getByName(name: string): NodeId | undefined {
    return this.nameIndex.get(name.toLowerCase());
  }

  clear(): void {
    this.indexes.clear();
    this.nameIndex.clear();
    this.initializeIndexes();
  }
}
