import { createContext } from 'react';
import type { ChatEvent, ChatOptions } from '../ai/ChatEvent.js';

/**
 * Outcome the React layer fires after a tool-call event has been
 * dispatched through the SceneController. Lets host UIs render
 * "N applied, M unknown" badges alongside chat bubbles. Phase 1 (0.8.0).
 */
export interface ToolCallOutcome {
  /** Tool name (`highlight` / `apply_filter` / `focus` / `annotate`). */
  tool: string;
  /** Ids the renderer accepted (i.e. resolved against the current store). */
  appliedIds?: string[];
  /** Ids the renderer rejected because the store doesn't know them. */
  unknownIds?: string[];
}

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
   *
   * May return a {@link ToolCallOutcome} when the controller can report
   * applied / unknown ids for the dispatched event (today: `highlight`
   * and `focus`). Returning `undefined` signals the hook should fall
   * back to its own `computeToolCallOutcome`.
   */
  dispatch: (event: ChatEvent) => ToolCallOutcome | undefined;
  /**
   * **Optional** — fire when the engine emits a `debug` ChatEvent.
   * Hosts use this to render diagnostic badges underneath assistant
   * bubbles. Phase 1 (0.8.0).
   */
  onDiagnostic?: (event: Extract<ChatEvent, { type: 'debug' }>) => void;
  /**
   * **Optional** — fire after a tool-call dispatch so hosts can show
   * "applied / unknown" outcome badges. Phase 1 (0.8.0).
   */
  onToolCallOutcome?: (outcome: ToolCallOutcome) => void;
}

export const ChatContext = createContext<InferaGraphChatContext | null>(null);
