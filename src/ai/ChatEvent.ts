import type { NodeData } from '../types.js';

/**
 * A domain-agnostic filter spec. Keys are node attribute names; values are
 * arrays of allowed string values. A node matches when, for EVERY key in
 * the spec, the node's attribute value (or, if the attribute is an array,
 * ANY element of it) is one of the listed strings.
 *
 * Same shape as the Phase 1 NLQ→filter compiler output. Phase 2's
 * `apply_filter` tool call carries one of these so the renderer / debug
 * consumers can inspect what the LLM decided.
 */
export interface FilterSpec {
  [attributeKey: string]: string[] | undefined;
}

/**
 * Public host-facing chat event stream. AIEngine.chat() yields these to
 * the consumer.
 *
 * Tool-call events (`apply_filter`, `highlight`, `focus`, `annotate`) are
 * suppressed from the host's iteration by default — the React layer
 * dispatches them silently to the renderer. Hosts that want to observe
 * tool calls (e.g. for debugging or building their own routing) can set
 * `ChatOptions.emitToolCalls = true`.
 */
export type ChatEvent =
  | {
      type: 'text';
      /** Streaming text delta. Concatenate across events to reconstruct the full message. */
      delta: string;
    }
  | {
      type: 'apply_filter';
      /** Raw filter spec the LLM emitted (for inspection / debug). */
      spec: FilterSpec;
      /**
       * Compiled predicate matching the spec, ready to drop into
       * `<InferaGraph filter>`. Same semantics as Phase 1's `compileFilter`
       * output — predicate runs against {@link NodeData}.
       */
      predicate: (node: NodeData) => boolean;
    }
  | {
      type: 'highlight';
      /**
       * Set of node ids the LLM wants emphasized. Empty set restores all.
       * Read-only by contract — consumers must not mutate.
       */
      ids: ReadonlySet<string>;
    }
  | {
      type: 'focus';
      /** Node id the camera should fly to. */
      nodeId: string;
    }
  | {
      type: 'annotate';
      /** Node id the annotation attaches to. */
      nodeId: string;
      /** LLM-authored callout text. Plain text — host is free to style. */
      text: string;
    }
  | {
      type: 'set_inferred_visibility';
      /** True to show the inferred-relationship overlay; false to hide it. */
      visible: boolean;
    }
  | {
      type: 'done';
      /** Why the stream ended. `'aborted'` = cancelled via AbortSignal. */
      reason?: 'stop' | 'length' | 'aborted';
      /**
       * Optional error message when the stream ended due to provider
       * failure. `done` is emitted even on the error path so host
       * consumers can release resources deterministically.
       */
      error?: string;
    };

/** Options for {@link AIEngine.chat}. */
export interface ChatOptions {
  /** Cancellation signal. Aborting yields `{type:'done', reason:'aborted'}`. */
  signal?: AbortSignal;
  /**
   * If `true`, tool-call events (`apply_filter` / `highlight` / `focus` /
   * `annotate`) are also yielded to the consumer of the AsyncIterable.
   *
   * Default `false`: tool calls are NOT yielded — the React layer owns
   * that dispatch path; the AIEngine.chat() iterable contains only `text`
   * + `done` events. Useful for non-React consumers and tests.
   */
  emitToolCalls?: boolean;
}
