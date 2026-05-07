import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy on SceneController so we can assert host-driven dispatch
// (`useInferaGraphCommands`) reaches the same controller surface that
// chat-driven tool calls hit. Default the highlight + focus mocks to the
// shared `{ appliedIds, unknownIds }` shape so the React layer's
// dispatch switch doesn't blow up while it reads back the partition.
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
import { useInferaGraphCommands } from '../../src/react/useInferaGraphCommands.js';
import type { InferaGraphCommands } from '../../src/react/useInferaGraphCommands.js';

interface CommandsHandle {
  cmds: InferaGraphCommands;
}

function CommandsChild({
  handleRef,
}: {
  handleRef: { current: CommandsHandle | null };
}): React.ReactElement {
  const cmds = useInferaGraphCommands();
  handleRef.current = { cmds };
  return <span />;
}

describe('useInferaGraphCommands', () => {
  beforeEach(() => {
    setHighlight.mockReset();
    setHighlight.mockReturnValue({ appliedIds: [], unknownIds: [] });
    setFilter.mockReset();
    focusOn.mockReset();
    focusOn.mockReturnValue({ appliedIds: [], unknownIds: [] });
    annotate.mockReset();
    clearAnnotations.mockReset();
    setInferredEdgeVisibility.mockReset();
    resetView.mockReset();
    clearVisualState.mockReset();
  });

  async function mountWithCommands(): Promise<CommandsHandle> {
    const handle: { current: CommandsHandle | null } = { current: null };
    render(
      <InferaGraph data={{ nodes: [], edges: [] }}>
        <CommandsChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    return handle.current!;
  }

  it('throws when used outside an <InferaGraph> subtree', () => {
    function Bad(): React.ReactElement {
      useInferaGraphCommands();
      return <span />;
    }
    expect(() => render(<Bad />)).toThrow(/inside an <InferaGraph>/i);
  });

  it('setHighlight(empty Set) dispatches highlight to the controller', async () => {
    const { cmds } = await mountWithCommands();
    await act(async () => {
      cmds.setHighlight(new Set<string>());
    });
    expect(setHighlight).toHaveBeenCalledTimes(1);
    const arg = setHighlight.mock.calls[0][0] as ReadonlySet<string>;
    expect(arg).toBeInstanceOf(Set);
    expect(arg.size).toBe(0);
  });

  it('focusOn(nodeId) dispatches to controller.focusOn', async () => {
    const { cmds } = await mountWithCommands();
    await act(async () => {
      cmds.focusOn('x');
    });
    expect(focusOn).toHaveBeenCalledTimes(1);
    expect(focusOn).toHaveBeenCalledWith('x');
  });

  it('applyFilter(spec) dispatches to controller.setFilter with a predicate', async () => {
    const { cmds } = await mountWithCommands();
    await act(async () => {
      cmds.applyFilter({ type: ['person'] });
    });
    // setFilter is called once initially with undefined (no filter prop).
    // The applyFilter command produces a SECOND call with a function
    // predicate compiled from the spec.
    expect(setFilter).toHaveBeenCalled();
    const lastCall = setFilter.mock.calls[setFilter.mock.calls.length - 1];
    expect(typeof lastCall[0]).toBe('function');
  });

  it('setInferredVisibility(true) dispatches to controller.setInferredEdgeVisibility', async () => {
    const { cmds } = await mountWithCommands();
    await act(async () => {
      cmds.setInferredVisibility(true);
    });
    // setInferredEdgeVisibility may be called once on mount (with undefined →
    // false default). The host-issued command is the LATEST call.
    expect(setInferredEdgeVisibility).toHaveBeenCalled();
    const lastCall =
      setInferredEdgeVisibility.mock.calls[
        setInferredEdgeVisibility.mock.calls.length - 1
      ];
    expect(lastCall[0]).toBe(true);
  });

  it('annotate(nodeId, text) dispatches to controller.annotate', async () => {
    const { cmds } = await mountWithCommands();
    await act(async () => {
      cmds.annotate('x', 'hi');
    });
    expect(annotate).toHaveBeenCalledWith('x', 'hi');
  });

  it('clearAnnotations() dispatches to controller.clearAnnotations', async () => {
    const { cmds } = await mountWithCommands();
    await act(async () => {
      cmds.clearAnnotations();
    });
    expect(clearAnnotations).toHaveBeenCalledTimes(1);
  });

  it('resetView() dispatches to controller.resetView', async () => {
    const { cmds } = await mountWithCommands();
    await act(async () => {
      cmds.resetView();
    });
    expect(resetView).toHaveBeenCalledTimes(1);
  });

  it('clearVisualState() dispatches to controller.clearVisualState', async () => {
    const { cmds } = await mountWithCommands();
    await act(async () => {
      cmds.clearVisualState();
    });
    expect(clearVisualState).toHaveBeenCalledTimes(1);
  });
});
