import type { NodeId, FilterPredicate } from '../types.js';
import type { GraphStore } from './GraphStore.js';
import type { Node } from './Node.js';

export class FilterEngine {
  constructor(private readonly store: GraphStore) {}

  filter(predicate: FilterPredicate): Node[] {
    return this.store.getAllNodes().filter((node) => predicate(node.attributes));
  }

  filterIds(predicate: FilterPredicate): NodeId[] {
    return this.filter(predicate).map((node) => node.id);
  }

  /** Generic attribute filter - works with any attribute key */
  filterByAttribute(key: string, value: unknown): Node[] {
    return this.filter((attrs) => attrs[key] === value);
  }

  /** Convenience: filter by 'type' attribute */
  filterByType(type: string): Node[] {
    return this.filterByAttribute('type', type);
  }

  /** Convenience: filter by nodes that have a specific tag in their 'tags' array */
  filterByTag(tag: string): Node[] {
    return this.filter((attrs) => {
      const tags = attrs.tags;
      return Array.isArray(tags) && tags.includes(tag);
    });
  }

  /** Alias for filterByAttribute */
  filterByProperty(key: string, value: unknown): Node[] {
    return this.filterByAttribute(key, value);
  }
}
