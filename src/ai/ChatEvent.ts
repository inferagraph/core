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
      /**
       * 0.11.0 — full-text replacement. Emitted by the engine AFTER the
       * model stream completes when a post-processing pass (e.g.
       * deterministic citation injection) produced text that differs
       * from the concatenation of the streamed `text` deltas. Hosts
       * MUST replace any accumulated streaming text with `text` so the
       * final bubble matches the corrected output.
       *
       * Carries the FULL final text (no diff format) so downstream
       * consumers (React hook, host renderer) only need a single
       * "set" operation. Engines that have nothing to correct simply
       * skip emitting this event.
       */
      type: 'text_replace';
      text: string;
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
      /**
       * 0.10.0 — host-driven "fresh canvas" command. Comprehensive reset:
       * clears highlights + annotations + filter, and snaps the camera
       * back to its initial orientation. Parameterless. Hosts dispatch
       * via `useInferaGraphCommands().clearVisualState()` (semantic
       * facade) or `useInferaGraphChatContext().dispatch({...})`
       * (low-level escape hatch).
       *
       * Servers MAY emit this on the wire (e.g. an automation route
       * fires "clear and re-frame" after a long batch), but the
       * primary use case is host UI ("Clear conversation").
       */
      type: 'clear_visual_state';
    }
  | {
      /**
       * 0.10.0 — camera-only home command. Snaps the camera back to its
       * captured initial orientation (radius preserved). Parameterless.
       */
      type: 'reset_view';
    }
  | {
      /**
       * 0.10.0 — drop every annotation currently mounted via the
       * AnnotationRenderer. Parameterless — there is no "clear one"
       * variant; per-node clearing stays an internal SceneController
       * affordance, not a chat-event surface.
       */
      type: 'clear_annotations';
    }
  | {
      type: 'debug';
      /**
       * Diagnostic phase the engine (or host route) is reporting on. Each
       * phase fires at most once per chat turn. Hosts can render these as
       * grey collapsible badges underneath the assistant bubble for ops
       * visibility — they MUST NOT be treated as model output.
       */
      phase:
        | 'stream-opened'
        | 'warmup-blocking'
        | 'warmup-failed'
        | 'vector-search'
        | 'rerank'
        | 'pronoun-resolve'
        | 'retrieval-complete'
        | 'retrieval-empty'
        | 'substitution-fired'
        | 'engine-empty'
        | 'conversation-cleared';
      /** Free-form per-phase narrative (e.g. `topK=8`). Optional. */
      detail?: string;
      /** Per-phase numeric counters (latency, candidate counts, etc.). Optional. */
      counters?: Record<string, number>;
      /**
       * Conversation id this debug event belongs to. Lets the host pin the
       * badge to the right turn when conversations multiplex over a single
       * connection. Optional — single-turn hosts can leave it unset.
       */
      conversationId?: string;
    }
  | {
      type: 'done';
      /** Why the stream ended. `'aborted'` = canceled via AbortSignal. */
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
  /**
   * Conversation id, scoped to whichever {@link ConversationStore} the
   * engine is configured with. When set, the engine fetches prior turns
   * for that id and appends the user + assistant turn after the stream
   * completes. Omit to opt out of conversation memory for this call.
   */
  conversationId?: string;
}
