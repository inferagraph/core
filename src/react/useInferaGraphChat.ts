import { useCallback, useContext, useRef } from 'react';
import { ChatContext } from './chatContext.js';
import type { ChatEvent, ChatOptions } from '../ai/ChatEvent.js';

/**
 * Public return shape of {@link useInferaGraphChat}. The hook returns a
 * single function that streams a chat with the configured transport.
 *
 * The returned `AsyncIterable` yields ONLY `text` and `done` events —
 * tool calls (`apply_filter`, `highlight`, `focus`, `annotate`) are
 * dispatched silently to the renderer, exactly mirroring the contract
 * of `<InferaGraph onChat>`.
 */
export interface InferaGraphChatHook {
  /**
   * Send `message` through the active chat transport. Returns an async
   * iterable that yields {@link ChatEvent}s — text + done only by
   * default. Tool-call events are dispatched to the renderer's
   * `setHighlight` / `setFilter` / `focusOn` / `annotate` and not
   * surfaced to the iterator.
   *
   * Pass `signal` to cancel mid-stream.
   *
   * Throws synchronously if no transport (or no `llm` prop) is
   * configured on the host `<InferaGraph>` element.
   */
  chat: (
    message: string,
    opts?: {
      signal?: AbortSignal;
      /**
       * Optional conversation id, forwarded to the active transport. When
       * the HTTP transport is in use the id flows into the request body
       * so the server route can thread it into its `ConversationStore`;
       * with the in-process transport the id is forwarded directly to
       * `AIEngine.chat`. Omit to opt out of conversation memory for this
       * call.
       */
      conversationId?: string;
    },
  ) => AsyncIterable<ChatEvent>;
}

/**
 * React hook that surfaces InferaGraph's chat API to the host.
 *
 * Internally:
 *   1. The hook resolves the active transport via React context
 *      (`<InferaGraph>` populates this).
 *   2. When `chat(message)` is called, the hook iterates the transport's
 *      full event stream:
 *        - tool-call events are dispatched to the SceneController's
 *          highlight / focus / annotate / filter sinks.
 *        - text + done events are re-yielded to the host.
 *   3. The host iterates the returned async iterable to render text
 *      bubbles. The renderer never appears in the host's iteration.
 *
 * MUST be called inside an `<InferaGraph>` subtree.
 */
export function useInferaGraphChat(): InferaGraphChatHook {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error(
      'useInferaGraphChat must be used inside an <InferaGraph> subtree',
    );
  }
  // The context object can change identity if the host swaps
  // transports. Stash the current value behind a ref so the returned
  // `chat` callback always reads the LATEST transport / dispatch
  // bindings without forcing a re-render in the consumer.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const chat = useCallback(
    (
      message: string,
      opts?: { signal?: AbortSignal; conversationId?: string },
    ): AsyncIterable<ChatEvent> => {
      const live = ctxRef.current;
      if (!live.getTransport()) {
        throw new Error(
          '<InferaGraph> chat is not available: no `llm` or `transport` prop configured',
        );
      }
      const chatOpts: ChatOptions = {
        signal: opts?.signal,
        emitToolCalls: true,
      };
      // Only set conversationId when the caller provided it — the
      // transport layer treats "missing" and "undefined" as equivalent
      // ("opt out of memory"), but we keep the field out of the options
      // object so HTTP serialization stays clean (no `null` keys).
      if (typeof opts?.conversationId === 'string') {
        chatOpts.conversationId = opts.conversationId;
      }
      return runChat(message, chatOpts, live);
    },
    [],
  );

  return { chat };
}

/**
 * Internal: drive the transport and split the stream into "host
 * iterable" + "renderer dispatch" pathways. Returns an `AsyncIterable`
 * whose iterator yields only text + done events.
 */
async function* runChat(
  message: string,
  opts: ChatOptions,
  ctx: {
    getTransport: () => { chat: (m: string, o?: ChatOptions) => AsyncIterable<ChatEvent> } | null;
    dispatch: (event: ChatEvent) => void;
    onDiagnostic?: (event: Extract<ChatEvent, { type: 'debug' }>) => void;
    onToolCallOutcome?: (outcome: {
      tool: string;
      appliedIds?: string[];
      unknownIds?: string[];
    }) => void;
  },
): AsyncGenerator<ChatEvent, void, unknown> {
  const transport = ctx.getTransport();
  if (!transport) {
    yield { type: 'done', reason: 'stop', error: 'no transport' };
    return;
  }
  const stream = transport.chat(message, opts);
  for await (const ev of stream) {
    if (ev.type === 'debug') {
      // Diagnostic events surface via the host's onDiagnostic callback,
      // not the iterator. Hosts render them as grey badges.
      ctx.onDiagnostic?.(ev);
      continue;
    }
    if (
      ev.type === 'apply_filter' ||
      ev.type === 'highlight' ||
      ev.type === 'focus' ||
      ev.type === 'annotate' ||
      ev.type === 'set_inferred_visibility'
    ) {
      // Dispatch to the renderer; do NOT surface to the host.
      ctx.dispatch(ev);
      // Fire an outcome callback so hosts can render "applied / unknown"
      // badges. The renderer doesn't currently report unknownIds back
      // through dispatch, so for now we surface the requested ids as
      // appliedIds. A future enhancement will reconcile against the
      // store's known-ids set.
      if (ctx.onToolCallOutcome) {
        const outcome = computeToolCallOutcome(ev);
        if (outcome) ctx.onToolCallOutcome(outcome);
      }
      continue;
    }
    yield ev;
  }
}

function computeToolCallOutcome(ev: ChatEvent): {
  tool: string;
  appliedIds?: string[];
  unknownIds?: string[];
} | undefined {
  switch (ev.type) {
    case 'highlight':
      return { tool: 'highlight', appliedIds: [...ev.ids] };
    case 'focus':
      return { tool: 'focus', appliedIds: [ev.nodeId] };
    case 'annotate':
      return { tool: 'annotate', appliedIds: [ev.nodeId] };
    case 'apply_filter':
      return { tool: 'apply_filter' };
    case 'set_inferred_visibility':
      return { tool: 'set_inferred_visibility' };
    default:
      return undefined;
  }
}
