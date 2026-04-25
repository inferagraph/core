import type { NodeId, FilterPredicate } from '../types.js';
import type { GraphStore } from './GraphStore.js';
import type { Node } from './Node.js';

export class FilterEngine {
  constructor(private readonly store: GraphStore) {}

  filter(predicate: FilterPredicate): Node[] {
    return this.store.getAllNodes().filter((node) => predicate(node.attributes));
  }

  filterByType(type: string): Node[] {
    return this.store.getNodesByType(type);
  }

  filterByTag(tag: string): Node[] {
    return this.store.getNodesByTag(tag);
  }

  filterByEra(era: string): Node[] {
    return this.filter((attrs) => attrs.era === era);
  }

  filterByGender(gender: string): Node[] {
    return this.filter((attrs) => attrs.gender === gender);
  }

  filterByProperty(key: string, value: unknown): Node[] {
    return this.filter((attrs) => attrs[key] === value);
  }

  filterIds(predicate: FilterPredicate): NodeId[] {
    return this.filter(predicate).map((node) => node.id);
  }
}
