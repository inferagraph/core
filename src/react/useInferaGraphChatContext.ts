import { useCallback, useContext, useRef } from 'react';
import { ChatContext } from './chatContext.js';
import type { ChatEvent } from '../ai/ChatEvent.js';

/**
 * Public return shape of {@link useInferaGraphChatContext}. The hook
 * surfaces the renderer's dispatch sink so a host can fire ad-hoc
 * {@link ChatEvent}s without going through `chat()`.
 *
 * The same dispatch path receives chat-driven tool-call events under
 * the hood — calling `dispatch(...)` here goes through the exact same
 * SceneController surface, which means highlights, filters, focus
 * moves, annotations, and the new visual-reset commands all behave
 * identically whether the model emits them or the host fires them.
 */
export interface InferaGraphChatContextHook {
  /**
   * Dispatch a {@link ChatEvent} into the renderer. Mostly useful for
   * host UI affordances ("Clear conversation" → reset highlight,
   * "Camera home" button → `reset_view`, etc.).
   *
   * Prefer {@link InferaGraphCommands} (`useInferaGraphCommands`) for
   * the typical cases — it's a thin semantic facade on top of this
   * sink. Reach for this hook when you need to dispatch an event
   * variant the facade doesn't surface (e.g. emitting a `debug`
   * ChatEvent for ops visibility, or a synthetic `text` event for
   * a UI-only "Welcome" bubble).
   */
  dispatch: (event: ChatEvent) => void;
}

/**
 * 0.10.0 — public escape-hatch hook returning the renderer's dispatch
 * function. Most hosts should reach for {@link useInferaGraphCommands}
 * instead; this hook exists for host code that needs to dispatch a
 * {@link ChatEvent} variant the semantic facade doesn't expose.
 *
 * MUST be called inside an `<InferaGraph>` subtree.
 */
export function useInferaGraphChatContext(): InferaGraphChatContextHook {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error(
      'useInferaGraphChatContext must be used inside an <InferaGraph> subtree',
    );
  }
  // Stash behind a ref so the returned `dispatch` callback always
  // reads the LATEST context value without forcing a re-render of
  // the caller when the host swaps transport / cache / etc.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const dispatch = useCallback((event: ChatEvent): void => {
    // The internal context's dispatch returns a `ToolCallOutcome | undefined`
    // (used by the chat iterator to surface "applied / unknown" badges).
    // Host-driven dispatches don't need that signal — they own the call
    // site and can introspect the controller directly if they care.
    void ctxRef.current.dispatch(event);
  }, []);

  return { dispatch };
}
