import { useMemo } from 'react';
import type { FilterSpec } from '../ai/ChatEvent.js';
import { buildPredicateFromSpec } from '../ai/AIEngine.js';
import { useInferaGraphChatContext } from './useInferaGraphChatContext.js';

/**
 * 0.10.0 — semantic facade for host-initiated graph commands. Most hosts
 * use this hook instead of the lower-level
 * {@link useInferaGraphChatContext}.
 *
 * Each method dispatches the equivalent {@link ChatEvent} to the
 * renderer's dispatch sink — exactly the same path the library uses for
 * chat-driven (model-emitted) events. There's no separate "host API"
 * that diverges from the chat contract.
 */
export interface InferaGraphCommands {
  /**
   * Replace the active highlight set. Pass an empty Set to clear (every
   * node returns to full opacity).
   */
  setHighlight(ids: ReadonlySet<string>): void;
  /**
   * Move the camera to the supplied node. The library does not have
   * an "unfocus" affordance — hosts that want to recenter should call
   * {@link resetView} instead.
   */
  focusOn(nodeId: string): void;
  /**
   * Apply a domain-agnostic filter spec to the visible graph. The spec
   * shape mirrors the LLM's `apply_filter` tool-call output: keys are
   * node attribute names, values are arrays of allowed string values.
   * Pass an empty object (`{}`) to clear the filter.
   */
  applyFilter(spec: FilterSpec): void;
  /** Toggle the inferred-edge overlay. */
  setInferredVisibility(visible: boolean): void;
  /** Attach a callout to a node. */
  annotate(nodeId: string, text: string): void;
  /** Drop every annotation currently mounted. */
  clearAnnotations(): void;
  /** Snap the camera back to its captured initial orientation. */
  resetView(): void;
  /**
   * Comprehensive reset — highlights + annotations + filter + camera.
   * The "fresh canvas" command. Hosts wire this to "Clear
   * conversation" / "New session" UX.
   */
  clearVisualState(): void;
}

/**
 * 0.10.0 — public, semantic hook for dispatching host-initiated graph
 * commands. Built on top of {@link useInferaGraphChatContext}, but with
 * a flat, named surface so callers don't have to construct
 * {@link ChatEvent} objects by hand.
 *
 * The returned object is memoized for the lifetime of the hook so
 * downstream `useEffect` / `useMemo` deps remain stable across renders.
 *
 * MUST be called inside an `<InferaGraph>` subtree.
 */
export function useInferaGraphCommands(): InferaGraphCommands {
  const { dispatch } = useInferaGraphChatContext();

  return useMemo<InferaGraphCommands>(
    () => ({
      setHighlight(ids) {
        dispatch({ type: 'highlight', ids });
      },
      focusOn(nodeId) {
        dispatch({ type: 'focus', nodeId });
      },
      applyFilter(spec) {
        // The dispatch sink expects a compiled predicate alongside the
        // spec (so renderer + debug consumers agree on the shape). Reuse
        // the same compiler the HTTP transport uses on the client side
        // when re-hydrating a wire-format `apply_filter` event — keeps a
        // single source of truth for spec semantics.
        dispatch({
          type: 'apply_filter',
          spec,
          predicate: buildPredicateFromSpec(spec),
        });
      },
      setInferredVisibility(visible) {
        dispatch({ type: 'set_inferred_visibility', visible });
      },
      annotate(nodeId, text) {
        dispatch({ type: 'annotate', nodeId, text });
      },
      clearAnnotations() {
        dispatch({ type: 'clear_annotations' });
      },
      resetView() {
        dispatch({ type: 'reset_view' });
      },
      clearVisualState() {
        dispatch({ type: 'clear_visual_state' });
      },
    }),
    [dispatch],
  );
}
