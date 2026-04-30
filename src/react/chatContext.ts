import { createContext } from 'react';
import type { ChatEvent, ChatOptions } from '../ai/ChatEvent.js';

/**
 * Internal: the React context surface that ties {@link useInferaGraphChat}
 * to the live transport + renderer dispatch installed by `<InferaGraph>`.
 *
 * Exposed via getters so the hook always reads the current values
 * without requiring a re-render of the consumer when the transport
 * swaps.
 */
export interface InferaGraphChatContext {
  /** Active chat transport. `null` when no `llm`/`transport` prop is set. */
  getTransport: () => {
    chat: (
      message: string,
      opts?: ChatOptions,
    ) => AsyncIterable<ChatEvent>;
  } | null;
  /**
   * Dispatch a tool-call event into the SceneController. Implementation
   * lives in `<InferaGraph>` because that's where the controller ref
   * is held.
   */
  dispatch: (event: ChatEvent) => void;
}

export const ChatContext = createContext<InferaGraphChatContext | null>(null);
