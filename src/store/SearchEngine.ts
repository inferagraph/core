import type { SearchResult } from '../types.js';
import type { GraphStore } from './GraphStore.js';

export interface SearchConfig {
  /** Attribute keys to search, in priority order (first = highest score) */
  searchableKeys: string[];
}

export class SearchEngine {
  private config: SearchConfig;

  constructor(
    private readonly store: GraphStore,
    config?: Partial<SearchConfig>,
  ) {
    this.config = {
      searchableKeys: config?.searchableKeys ?? ['name', 'aliases', 'tags', 'content'],
    };
  }

  configure(config: Partial<SearchConfig>): void {
    Object.assign(this.config, config);
  }

  search(query: string): SearchResult[] {
    const lowerQuery = query.toLowerCase();
    const results: SearchResult[] = [];
    const keyCount = this.config.searchableKeys.length;

    for (const node of this.store.getAllNodes()) {
      const matches: string[] = [];
      let score = 0;

      for (let i = 0; i < keyCount; i++) {
        const key = this.config.searchableKeys[i];
        const value = node.attributes[key];
        // Priority score: first key gets highest base score, decreasing by index
        const priorityScore = keyCount - i;

        if (value == null) continue;

        if (typeof value === 'string') {
          if (value.toLowerCase().includes(lowerQuery)) {
            matches.push(`${key}: ${value}`);
            // Exact match gets double the priority score
            score += value.toLowerCase() === lowerQuery ? priorityScore * 2 : priorityScore;
          }
        } else if (Array.isArray(value)) {
          for (const element of value) {
            if (typeof element === 'string' && element.toLowerCase().includes(lowerQuery)) {
              matches.push(`${key}: ${element}`);
              score += priorityScore;
            }
          }
        }
      }

      if (matches.length > 0) {
        results.push({ nodeId: node.id, score, matches });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}
