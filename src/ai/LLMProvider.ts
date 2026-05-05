/**
 * Per-call options accepted by every {@link LLMProvider}.
 *
 * Providers may ignore unsupported fields. Defaults are deliberately left to
 * the provider so the host doesn't have to know which model is in use.
 */
export interface CompleteOptions {
  /** Maximum tokens to generate. Default left to provider. */
  maxTokens?: number;
  /** Sampling temperature (0-1). Default left to provider. */
  temperature?: number;
  /**
   * A response-format hint. Some providers (Anthropic, OpenAI JSON mode, etc.)
   * can constrain output to JSON. Providers that don't support format hints
   * simply ignore this field; the consumer is still expected to validate.
   */
  format?: 'json' | 'text';
}

/**
 * A tool definition the LLM may emit calls for. The shape mirrors what
 * Anthropic / OpenAI tool-calling APIs accept: a name, a human-readable
 * description, and a JSON-Schema for the arguments.
 *
 * AIEngine builds these for the four Phase 2 visual instructions
 * (`apply_filter`, `highlight`, `focus`, `annotate`) and hands them to the
 * provider via {@link StreamOptions.tools}. Providers translate them into
 * whatever format their underlying SDK expects.
 */
export interface LLMToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. Opaque to InferaGraph. */
  parameters: Record<string, unknown>;
}

/**
 * Per-call options accepted by {@link LLMProvider.stream}. Extends
 * {@link CompleteOptions} with streaming-specific concerns: cancellation
 * via `AbortSignal` and the tool definitions the LLM may emit calls for.
 */
export interface StreamOptions extends CompleteOptions {
  /**
   * Optional cancellation signal. When aborted mid-stream the provider must
   * stop yielding events and emit a final `{type: 'done', reason: 'aborted'}`
   * if the stream is still alive — providers may choose to throw an
   * `AbortError` instead, but {@link AIEngine.chat} normalizes both shapes.
   */
  signal?: AbortSignal;
  /**
   * Tool definitions the provider can emit calls for. Each entry is a
   * JSON Schema describing a callable tool. AIEngine populates this before
   * calling stream() so the LLM knows which visual instructions are valid.
   */
  tools?: LLMToolDefinition[];
}

/**
 * A single event in an LLM streaming response. Providers map their native
 * stream protocols (Anthropic SSE, OpenAI SSE, etc.) onto this uniform
 * shape so InferaGraph's AIEngine can consume them without knowing which
 * provider is in use.
 *
 * `arguments` on a `tool_call` event is the RAW JSON string emitted by the
 * model — the AIEngine parses + validates before turning it into a
 * {@link ChatEvent}.
 */
export type LLMStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; arguments: string }
  | { type: 'done'; reason?: 'stop' | 'length' | 'aborted' };

/**
 * The LLM provider contract. Phase 1 added `complete()`; Phase 2 adds
 * `stream()` for the streaming chat / tool-call path; Phase 3 adds the
 * **optional** `embed()` method for vector embeddings.
 *
 * Hosts NEVER invoke this directly. They import a provider package
 * (`@inferagraph/anthropic-provider`, `@inferagraph/openai-provider`, etc.)
 * and pass a configured instance to `<InferaGraph llm={...} />`. From that
 * point on InferaGraph owns the entire LLM lifecycle.
 *
 * Providers without native embedding support (e.g. raw Anthropic) simply
 * omit `embed`; consumers can still mix-and-match — pass an Anthropic
 * provider for chat AND a separate provider for embeddings (or, in the
 * Anthropic provider's case, provide a Voyage AI key in its config so it
 * exposes an `embed` itself).
 */
export interface LLMProvider {
  /** Provider name for diagnostics (e.g., "anthropic", "openai", "mock"). */
  readonly name: string;
  /** Send a prompt to the model, get a single response back. */
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
  /**
   * Streaming completion. Returns an async iterable of LLM stream events.
   * Tool calls come through as `tool_call` events; the provider does NOT
   * interpret them — it forwards whatever the underlying LLM emits.
   * AIEngine consumes the stream and decides whether each event is host-
   * visible or silently dispatched to the renderer.
   *
   * Providers MUST always emit a final `{type: 'done'}` event so consumers
   * can release resources deterministically; this is true even on error /
   * cancellation paths (use `reason: 'aborted'`).
   */
  stream(prompt: string, opts?: StreamOptions): AsyncIterable<LLMStreamEvent>;
  /**
   * **Optional** — embed a batch of texts and return one vector per text,
   * in the same order. Providers that don't support embeddings MUST omit
   * this method entirely (rather than throwing) so the AIEngine's tier
   * detection can identify them via `'embed' in provider`.
   *
   * Implementations should preserve input order, return plain `number[]`
   * vectors (not typed arrays — see {@link Vector}), and respect
   * `opts.signal` when supported by the underlying SDK.
   */
  embed?(texts: string[], opts?: EmbedOptions): Promise<Vector[]>;
}

// Re-export the embedding types here so provider authors only need to import
// from one path. The canonical definitions live in ./Embedding.ts.
export type { Vector, EmbedOptions } from './Embedding.js';
import type { Vector, EmbedOptions } from './Embedding.js';
