import type { ConversationStore, ConversationTurn } from './ConversationStore.js';

export type { ConversationStore, ConversationTurn };

/**
 * In-process default {@link ConversationStore}. Backed by a single `Map`
 * keyed by `conversationId`. Insertion order is the source of truth for
 * chronological order; `getTurns(id, limit)` returns the LAST `limit`
 * entries — that window is the tail of the chronological order, with the
 * oldest of the window first and the newest last.
 *
 * No TTL: in-memory is for tests + single-process dev. Production hosts
 * should swap in `RedisConversationStore` from
 * `@inferagraph/redis-cache-provider`.
 */
class MemoryConversationStore implements ConversationStore {
  private readonly map = new Map<string, ConversationTurn[]>();

  async getTurns(
    conversationId: string,
    limit: number,
  ): Promise<ConversationTurn[]> {
    if (limit <= 0) return [];
    const all = this.map.get(conversationId);
    if (!all || all.length === 0) return [];
    if (all.length <= limit) return all.slice();
    return all.slice(all.length - limit);
  }

  async appendTurn(
    conversationId: string,
    turn: ConversationTurn,
  ): Promise<void> {
    let bucket = this.map.get(conversationId);
    if (!bucket) {
      bucket = [];
      this.map.set(conversationId, bucket);
    }
    // Clone to avoid caller mutation bleeding into the store.
    bucket.push({
      role: turn.role,
      content: turn.content,
      timestamp: turn.timestamp,
      retrievedNodeIds: turn.retrievedNodeIds
        ? turn.retrievedNodeIds.slice()
        : undefined,
    });
  }

  async clear(conversationId: string): Promise<void> {
    this.map.delete(conversationId);
  }
}

/** Factory: construct an in-memory {@link ConversationStore}. */
export function inMemoryConversationStore(): ConversationStore {
  return new MemoryConversationStore();
}
