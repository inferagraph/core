import type {
  CompleteOptions,
  LLMProvider,
  LLMStreamEvent,
  StreamOptions,
} from './LLMProvider.js';
import type { EmbedOptions, Vector } from './Embedding.js';

/**
 * Test-only mock provider. Accepts either:
 *   - a static map of `prompt → response` (exact-match lookup), or
 *   - a function `(prompt, opts) => string | Promise<string>` for dynamic responses.
 *
 * In addition to satisfying {@link LLMProvider}, the returned object exposes
 * `getCallCount()` and `getLastPrompt()` for test inspection. These are mock-
 * only conveniences and are NOT part of the `LLMProvider` interface — runtime
 * code that depends on them is a smell.
 *
 * Streaming behavior:
 *   - When the canned source is a map, the value is treated as a single text
 *     delta. The mock yields `{type: 'text', delta}` then `{type: 'done',
 *     reason: 'stop'}`.
 *   - When the canned source is a function, it may return a string (single
 *     text delta) OR an array of {@link LLMStreamEvent} (explicit sequence).
 *     Returning an explicit sequence lets tests exercise the tool-call path.
 *     A trailing `done` event is auto-appended if the array doesn't include
 *     one — tests should normally include it themselves to verify the
 *     stream-end contract.
 */
export interface MockLLMProvider extends LLMProvider {
  /** Always defined on the mock — the constructor wires a deterministic embedder. */
  embed(texts: string[], opts?: EmbedOptions): Promise<Vector[]>;
  /** Number of times `complete` has been called since construction. */
  getCallCount(): number;
  /** The last prompt passed to `complete` or `stream`, or `undefined` if never called. */
  getLastPrompt(): string | undefined;
  /** Number of times `stream` has been called since construction. */
  getStreamCallCount(): number;
  /** Number of times `embed` has been called since construction. */
  getEmbedCallCount(): number;
  /** The last batch of texts passed to `embed`. */
  getLastEmbedBatch(): string[] | undefined;
  /** The last `StreamOptions` passed to `stream`. */
  getLastStreamOptions(): StreamOptions | undefined;
  /** Reset call-count + last-prompt state without re-creating the mock. */
  reset(): void;
}

/**
 * Optional configuration for the mock's `embed()` path. Two forms:
 *   - `Record<string, Vector>` — exact-match map; missing texts fall back to
 *     a deterministic hash-derived vector.
 *   - `(text: string) => Vector` — function form; called per text.
 *
 * Pass `undefined` (or omit) to use the default deterministic-hash embedder.
 */
export type MockEmbedSource =
  | Record<string, Vector>
  | ((text: string) => Vector | Promise<Vector>);

/**
 * Construct a {@link MockLLMProvider}. Used by the package's own tests AND by
 * downstream consumers that want a no-op baseline before wiring a real provider.
 *
 * When the canned source is a map, an unmatched prompt yields `''`. Tests that
 * care about the unmatched case should use the function form and throw.
 */
export function mockLLMProvider(
  canned:
    | Record<string, string>
    | ((
        prompt: string,
        opts?: CompleteOptions | StreamOptions,
      ) =>
        | string
        | LLMStreamEvent[]
        | Promise<string | LLMStreamEvent[]>),
  embedSource?: MockEmbedSource,
): MockLLMProvider {
  let callCount = 0;
  let streamCallCount = 0;
  let embedCallCount = 0;
  let lastPrompt: string | undefined;
  let lastStreamOptions: StreamOptions | undefined;
  let lastEmbedBatch: string[] | undefined;

  const isFn = typeof canned === 'function';

  async function resolveCanned(
    prompt: string,
    opts?: CompleteOptions | StreamOptions,
  ): Promise<string | LLMStreamEvent[]> {
    if (isFn) {
      return await (
        canned as (
          p: string,
          o?: CompleteOptions | StreamOptions,
        ) =>
          | string
          | LLMStreamEvent[]
          | Promise<string | LLMStreamEvent[]>
      )(prompt, opts);
    }
    const map = canned as Record<string, string>;
    return Object.prototype.hasOwnProperty.call(map, prompt) ? map[prompt] : '';
  }

  return {
    name: 'mock',

    async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
      callCount += 1;
      lastPrompt = prompt;
      const resolved = await resolveCanned(prompt, opts);
      if (typeof resolved === 'string') return resolved;
      // If the canned source returned an event array via the streaming
      // form, collapse it to a concatenation of text deltas so `complete`
      // still returns a single string.
      let collapsed = '';
      for (const ev of resolved) {
        if (ev.type === 'text') collapsed += ev.delta;
      }
      return collapsed;
    },

    async *stream(
      prompt: string,
      opts?: StreamOptions,
    ): AsyncGenerator<LLMStreamEvent, void, unknown> {
      streamCallCount += 1;
      lastPrompt = prompt;
      lastStreamOptions = opts;

      // Honor pre-aborted signals: emit a single `done` and stop.
      if (opts?.signal?.aborted) {
        yield { type: 'done', reason: 'aborted' };
        return;
      }

      const resolved = await resolveCanned(prompt, opts);

      // Re-check abort after the (possibly async) canned resolver.
      if (opts?.signal?.aborted) {
        yield { type: 'done', reason: 'aborted' };
        return;
      }

      if (typeof resolved === 'string') {
        if (resolved.length > 0) {
          yield { type: 'text', delta: resolved };
        }
        yield { type: 'done', reason: 'stop' };
        return;
      }

      let sawDone = false;
      for (const ev of resolved) {
        if (opts?.signal?.aborted) {
          yield { type: 'done', reason: 'aborted' };
          return;
        }
        if (ev.type === 'done') sawDone = true;
        yield ev;
      }
      if (!sawDone) {
        yield { type: 'done', reason: 'stop' };
      }
    },

    async embed(texts: string[], opts?: EmbedOptions): Promise<Vector[]> {
      embedCallCount += 1;
      lastEmbedBatch = texts.slice();
      if (opts?.signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      const out: Vector[] = [];
      for (const text of texts) {
        if (opts?.signal?.aborted) {
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        }
        out.push(await resolveEmbed(text, embedSource));
      }
      return out;
    },

    getCallCount(): number {
      return callCount;
    },

    getLastPrompt(): string | undefined {
      return lastPrompt;
    },

    getStreamCallCount(): number {
      return streamCallCount;
    },

    getEmbedCallCount(): number {
      return embedCallCount;
    },

    getLastEmbedBatch(): string[] | undefined {
      return lastEmbedBatch ? lastEmbedBatch.slice() : undefined;
    },

    getLastStreamOptions(): StreamOptions | undefined {
      return lastStreamOptions;
    },

    reset(): void {
      callCount = 0;
      streamCallCount = 0;
      embedCallCount = 0;
      lastPrompt = undefined;
      lastStreamOptions = undefined;
      lastEmbedBatch = undefined;
    },
  };
}

/**
 * Resolve one text into a deterministic vector, using the configured
 * `embedSource` when supplied, falling back to a stable hash-derived vector.
 */
async function resolveEmbed(
  text: string,
  source: MockEmbedSource | undefined,
): Promise<Vector> {
  if (source) {
    if (typeof source === 'function') {
      return await source(text);
    }
    if (Object.prototype.hasOwnProperty.call(source, text)) {
      const v = source[text];
      return v.slice();
    }
  }
  return deterministicVector(text);
}

/**
 * Deterministic 32-dimensional vector derived from the input text. Same text
 * always produces the same vector; small text changes produce small vector
 * changes (within the FNV mixing budget). Sufficient for ranking-correctness
 * tests but NOT a real embedding model — consumers needing actual semantic
 * similarity must wire a real provider.
 */
export function deterministicVector(text: string, dim = 32): Vector {
  // Generate `dim` independent FNV-1a streams by salting the input with a
  // dimension index. This gives uncorrelated-looking floats that are still
  // perfectly reproducible.
  const out = new Array<number>(dim);
  for (let d = 0; d < dim; d++) {
    let hi = 0xcbf29ce4 | 0;
    let lo = 0x84222325 | 0;
    const salted = `${d}|${text}`;
    for (let i = 0; i < salted.length; i++) {
      const code = salted.charCodeAt(i);
      lo = (lo ^ code) >>> 0;
      const PRIME_HI = 0x100;
      const PRIME_LO = 0x000001b3;
      const loMul = Math.imul(lo, PRIME_LO);
      const hiMul = Math.imul(hi, PRIME_LO) + Math.imul(lo, PRIME_HI);
      lo = loMul >>> 0;
      hi = (hiMul + ((loMul / 0x100000000) | 0)) >>> 0;
    }
    // Map the 32-bit `lo` half into [-1, 1] via signed normalization.
    const signed = (lo | 0) / 0x80000000;
    out[d] = signed;
  }
  // L2-normalize so cosine similarity behaves on a unit-sphere scale.
  let mag = 0;
  for (const x of out) mag += x * x;
  mag = Math.sqrt(mag);
  if (mag === 0) return out;
  for (let i = 0; i < out.length; i++) out[i] /= mag;
  return out;
}
