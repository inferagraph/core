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
    opts?: { signal?: AbortSignal },
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
    (message: string, opts?: { signal?: AbortSignal }): AsyncIterable<ChatEvent> => {
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
  },
): AsyncGenerator<ChatEvent, void, unknown> {
  const transport = ctx.getTransport();
  if (!transport) {
    yield { type: 'done', reason: 'stop', error: 'no transport' };
    return;
  }
  const stream = transport.chat(message, opts);
  for await (const ev of stream) {
    if (
      ev.type === 'apply_filter' ||
      ev.type === 'highlight' ||
      ev.type === 'focus' ||
      ev.type === 'annotate' ||
      ev.type === 'set_inferred_visibility'
    ) {
      // Dispatch to the renderer; do NOT surface to the host.
      ctx.dispatch(ev);
      continue;
    }
    yield ev;
  }
}
