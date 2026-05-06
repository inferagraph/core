/**
 * Phase 1 (RAG architecture) — multi-turn conversation memory contract.
 *
 * Hosts that want chat to be session-aware pass a {@link ConversationStore}
 * implementation to {@link AIEngine.setConversationStore}. The engine reads
 * the prior turns at the start of each chat call and appends the user +
 * assistant turns once the stream completes.
 *
 * Each turn carries the bare minimum needed for pronoun resolution and UI
 * rendering: role, raw text, an ISO-millisecond timestamp, and the optional
 * `retrievedNodeIds` produced by the retrieval pipeline. Anything richer
 * (provenance, token counts, debug events) lives outside this contract.
 *
 * Two reference impls ship with the platform:
 *   - {@link inMemoryConversationStore} (this package) — Map-backed, for
 *     tests + single-process dev.
 *   - `RedisConversationStore` from `@inferagraph/redis-cache-provider` —
 *     production-grade, with TTL handling.
 *
 * The contract is intentionally tiny so future backends (Postgres, DDB,
 * etc.) only need to implement three methods.
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Epoch milliseconds; producer-controlled. */
  timestamp: number;
  /**
   * Node ids retrieved while answering this turn. Populated only on
   * assistant turns by the engine; user turns leave it `undefined`. Used by
   * pronoun resolution on subsequent turns ("tell me more about him").
   */
  retrievedNodeIds?: string[];
}

export interface ConversationStore {
  /**
   * Return the most-recent `limit` turns for `conversationId`, in
   * chronological order (oldest first within the returned window). The
   * total turn count may exceed `limit`; only the tail is returned.
   *
   * Returns an empty array when the conversation is unknown — never
   * throws, so the engine can call without a try/catch on every chat.
   */
  getTurns(conversationId: string, limit: number): Promise<ConversationTurn[]>;
  /** Append one turn. Implementations are responsible for any TTL handling. */
  appendTurn(conversationId: string, turn: ConversationTurn): Promise<void>;
  /** Drop every turn for `conversationId`. */
  clear(conversationId: string): Promise<void>;
}
