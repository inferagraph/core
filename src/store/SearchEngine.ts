import type { SearchResult } from '../types.js';
import type { GraphStore } from './GraphStore.js';

export class SearchEngine {
  constructor(private readonly store: GraphStore) {}

  search(query: string): SearchResult[] {
    const lowerQuery = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const node of this.store.getAllNodes()) {
      const matches: string[] = [];
      let score = 0;

      const { name, aliases, tags, content } = node.attributes;

      if (name.toLowerCase().includes(lowerQuery)) {
        matches.push(`name: ${name}`);
        score += name.toLowerCase() === lowerQuery ? 10 : 5;
      }

      if (aliases) {
        for (const alias of aliases) {
          if (alias.toLowerCase().includes(lowerQuery)) {
            matches.push(`alias: ${alias}`);
            score += 3;
          }
        }
      }

      if (tags) {
        for (const tag of tags) {
          if (tag.toLowerCase().includes(lowerQuery)) {
            matches.push(`tag: ${tag}`);
            score += 2;
          }
        }
      }

      if (content && content.toLowerCase().includes(lowerQuery)) {
        matches.push('content');
        score += 1;
      }

      if (matches.length > 0) {
        results.push({ nodeId: node.id, score, matches });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}
