import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same SceneController shim used by useInferaGraphCommands.test — the
// new low-level dispatch hook routes ChatEvents through the same
// dispatch sink that chat() uses, so verifying the controller surface
// is reached is the cleanest assertion.
const setHighlight = vi
  .fn()
  .mockReturnValue({ appliedIds: [], unknownIds: [] });
const setFilter = vi.fn();
const focusOn = vi.fn().mockReturnValue({ appliedIds: [], unknownIds: [] });
const annotate = vi.fn();
const clearAnnotations = vi.fn();
const setInferredEdgeVisibility = vi.fn();
const resetView = vi.fn();
const clearVisualState = vi.fn();

vi.mock('../../src/renderer/SceneController.js', () => ({
  SceneController: vi.fn().mockImplementation(() => ({
    attach: vi.fn(),
    detach: vi.fn(),
    syncFromStore: vi.fn(),
    setLayout: vi.fn(),
    setNodeRender: vi.fn(),
    setTooltip: vi.fn(),
    setIncomingEdgeLabels: vi.fn(),
    setOutgoingEdgeLabels: vi.fn(),
    setFilter,
    setHighlight,
    focusOn,
    annotate,
    clearAnnotations,
    setInferredEdgeVisibility,
    resetView,
    clearVisualState,
    resize: vi.fn(),
  })),
}));

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { InferaGraph } from '../../src/react/InferaGraph.js';
import { useInferaGraphChatContext } from '../../src/react/useInferaGraphChatContext.js';
import type { ChatEvent } from '../../src/ai/ChatEvent.js';

interface DispatchHandle {
  dispatch: (event: ChatEvent) => void;
}

function DispatchChild({
  handleRef,
}: {
  handleRef: { current: DispatchHandle | null };
}): React.ReactElement {
  const { dispatch } = useInferaGraphChatContext();
  handleRef.current = { dispatch };
  return <span />;
}

describe('useInferaGraphChatContext', () => {
  beforeEach(() => {
    setHighlight.mockReset();
    setHighlight.mockReturnValue({ appliedIds: [], unknownIds: [] });
    clearVisualState.mockReset();
    resetView.mockReset();
    clearAnnotations.mockReset();
  });

  it('throws when used outside an <InferaGraph> subtree', () => {
    function Bad(): React.ReactElement {
      useInferaGraphChatContext();
      return <span />;
    }
    expect(() => render(<Bad />)).toThrow(/inside an <InferaGraph>/i);
  });

  it('returns a dispatch function the host can call to reach the controller', async () => {
    const handle: { current: DispatchHandle | null } = { current: null };
    render(
      <InferaGraph data={{ nodes: [], edges: [] }}>
        <DispatchChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    expect(typeof handle.current!.dispatch).toBe('function');

    await act(async () => {
      handle.current!.dispatch({
        type: 'highlight',
        ids: new Set<string>(),
      });
    });
    expect(setHighlight).toHaveBeenCalledTimes(1);
    const arg = setHighlight.mock.calls[0][0] as ReadonlySet<string>;
    expect(arg.size).toBe(0);
  });

  it('routes the new clear_visual_state event to controller.clearVisualState', async () => {
    const handle: { current: DispatchHandle | null } = { current: null };
    render(
      <InferaGraph data={{ nodes: [], edges: [] }}>
        <DispatchChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());

    await act(async () => {
      handle.current!.dispatch({ type: 'clear_visual_state' });
    });
    expect(clearVisualState).toHaveBeenCalledTimes(1);
  });

  it('routes the new reset_view event to controller.resetView', async () => {
    const handle: { current: DispatchHandle | null } = { current: null };
    render(
      <InferaGraph data={{ nodes: [], edges: [] }}>
        <DispatchChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());

    await act(async () => {
      handle.current!.dispatch({ type: 'reset_view' });
    });
    expect(resetView).toHaveBeenCalledTimes(1);
  });

  it('routes the new clear_annotations event to controller.clearAnnotations', async () => {
    const handle: { current: DispatchHandle | null } = { current: null };
    render(
      <InferaGraph data={{ nodes: [], edges: [] }}>
        <DispatchChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());

    await act(async () => {
      handle.current!.dispatch({ type: 'clear_annotations' });
    });
    expect(clearAnnotations).toHaveBeenCalledTimes(1);
  });
});
