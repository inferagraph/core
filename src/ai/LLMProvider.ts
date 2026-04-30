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
 * The Phase-1 LLM contract: send a prompt, get a single string back.
 *
 * Streaming and tool-calls land in Phase 2 (Chat API); Phase 1 is intentionally
 * request/response only so the surface area is tiny while we wire NLQ → filter
 * predicate.
 *
 * Hosts NEVER invoke this directly. They import a provider package
 * (`@inferagraph/anthropic-provider`, `@inferagraph/openai-provider`, etc.)
 * and pass a configured instance to `<InferaGraph llm={...} />`. From that
 * point on InferaGraph owns the entire LLM lifecycle.
 */
export interface LLMProvider {
  /** Provider name for diagnostics (e.g., "anthropic", "openai", "mock"). */
  readonly name: string;
  /** Send a prompt to the model, get a single response back. */
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}
