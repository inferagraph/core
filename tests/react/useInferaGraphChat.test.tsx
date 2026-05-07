import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy on SceneController so we can assert tool-call dispatch goes through it.
// 0.9.3: setHighlight + focusOn now return `{ appliedIds, unknownIds }` so
// the React layer can surface "tried to highlight Z but it isn't in the
// graph" badges. Default the mocks to the empty-partition shape.
const setHighlight = vi
  .fn()
  .mockReturnValue({ appliedIds: [], unknownIds: [] });
const setFilter = vi.fn();
const focusOn = vi.fn().mockReturnValue({ appliedIds: [], unknownIds: [] });
const annotate = vi.fn();
const clearAnnotations = vi.fn();

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
    // Phase 5: inferred-edge overlay dispatch surface. Stubbed so the
    // useEffect that pushes `showInferredEdges` doesn't blow up.
    setInferredEdgeVisibility: vi.fn(),
    resize: vi.fn(),
  })),
}));

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { InferaGraph } from '../../src/react/InferaGraph.js';
import { useInferaGraphChat } from '../../src/react/useInferaGraphChat.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import type { ChatEvent } from '../../src/ai/ChatEvent.js';
import type {
  LLMStreamEvent,
} from '../../src/ai/LLMProvider.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

interface ChildHandle {
  invoke: (msg: string) => Promise<ChatEvent[]>;
}

function ChatChild({ handleRef }: { handleRef: { current: ChildHandle | null } }): React.ReactElement {
  const { chat } = useInferaGraphChat();
  handleRef.current = {
    invoke: async (msg: string) => collect(chat(msg)),
  };
  return <span />;
}

describe('useInferaGraphChat', () => {
  beforeEach(() => {
    setHighlight.mockReset();
    setHighlight.mockReturnValue({ appliedIds: [], unknownIds: [] });
    setFilter.mockReset();
    focusOn.mockReset();
    focusOn.mockReturnValue({ appliedIds: [], unknownIds: [] });
    annotate.mockReset();
    clearAnnotations.mockReset();
  });

  it('throws when used outside an <InferaGraph> subtree', () => {
    function Bad(): React.ReactElement {
      // Force rendering to reach the hook throw.
      useInferaGraphChat();
      return <span />;
    }
    expect(() => render(<Bad />)).toThrow(/inside an <InferaGraph>/i);
  });

  it('routes text events to the iterable, tool calls to the controller', async () => {
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      { type: 'text', delta: 'sure ' },
      {
        type: 'tool_call',
        name: 'highlight',
        arguments: JSON.stringify({ ids: ['x', 'y'] }),
      },
      { type: 'text', delta: 'done.' },
      { type: 'done', reason: 'stop' },
    ]);
    const handle: { current: ChildHandle | null } = { current: null };
    const { container } = render(
      <InferaGraph llm={provider} data={{ nodes: [], edges: [] }}>
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    void container;

    await waitFor(() => expect(handle.current).not.toBeNull());
    const events = await act(async () => handle.current!.invoke('hi'));
    // Tool calls must NOT appear in the host iterable.
    expect(events.some((e) => e.type === 'highlight')).toBe(false);
    // But text + done must.
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta)).toEqual([
      'sure ',
      'done.',
    ]);
    expect(events.find((e) => e.type === 'done')).toBeDefined();
    // Highlight tool call should have been dispatched to the controller.
    expect(setHighlight).toHaveBeenCalledTimes(1);
  });

  it('dispatches focus tool calls to controller.focusOn', async () => {
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      {
        type: 'tool_call',
        name: 'focus',
        arguments: JSON.stringify({ nodeId: 'x' }),
      },
      { type: 'done', reason: 'stop' },
    ]);
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph llm={provider} data={{ nodes: [], edges: [] }}>
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    await act(async () => handle.current!.invoke('focus'));
    expect(focusOn).toHaveBeenCalledTimes(1);
    expect(focusOn).toHaveBeenCalledWith('x');
  });

  it('dispatches annotate tool calls to controller.annotate', async () => {
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      {
        type: 'tool_call',
        name: 'annotate',
        arguments: JSON.stringify({ nodeId: 'x', text: 'hi' }),
      },
      { type: 'done', reason: 'stop' },
    ]);
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph llm={provider} data={{ nodes: [], edges: [] }}>
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    await act(async () => handle.current!.invoke('note'));
    expect(annotate).toHaveBeenCalledWith('x', 'hi');
  });

  it('dispatches apply_filter tool calls to controller.setFilter', async () => {
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      {
        type: 'tool_call',
        name: 'apply_filter',
        arguments: JSON.stringify({ spec: { type: ['person'] } }),
      },
      { type: 'done', reason: 'stop' },
    ]);
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph llm={provider} data={{ nodes: [], edges: [] }}>
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    await act(async () => handle.current!.invoke('only people'));
    // setFilter is called once initially with undefined (no filter prop).
    // After the chat dispatches apply_filter, we get a SECOND call with a
    // function predicate.
    expect(setFilter).toHaveBeenCalled();
    const lastCall = setFilter.mock.calls[setFilter.mock.calls.length - 1];
    expect(typeof lastCall[0]).toBe('function');
  });

  it('chat throws when no transport is configured', async () => {
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph data={{ nodes: [], edges: [] }}>
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    await expect(handle.current!.invoke('hi')).rejects.toThrow(/transport/i);
  });
});

describe('useInferaGraphChat — Phase 1 (0.8.0) callbacks', () => {
  beforeEach(() => {
    setHighlight.mockReset();
    setHighlight.mockReturnValue({ appliedIds: [], unknownIds: [] });
    setFilter.mockReset();
    focusOn.mockReset();
    focusOn.mockReturnValue({ appliedIds: [], unknownIds: [] });
    annotate.mockReset();
    clearAnnotations.mockReset();
  });

  it('dispatches debug events via chatContext.onDiagnostic', async () => {
    // Drive a transport that yields a `debug` event.
    const customTransport = {
      // eslint-disable-next-line require-yield
      async *chat(): AsyncGenerator<ChatEvent, void, unknown> {
        yield {
          type: 'debug',
          phase: 'vector-search',
          detail: 'topK=8',
        };
        yield { type: 'done', reason: 'stop' };
      },
    };
    const onDiagnostic = vi.fn();
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph
        data={{ nodes: [], edges: [] }}
        transport={customTransport}
        onDiagnostic={onDiagnostic}
      >
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    await act(async () => handle.current!.invoke('hi'));
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic.mock.calls[0][0]).toMatchObject({
      type: 'debug',
      phase: 'vector-search',
    });
  });

  it('fires chatContext.onToolCallOutcome after a tool-call dispatch', async () => {
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      {
        type: 'tool_call',
        name: 'highlight',
        arguments: JSON.stringify({ ids: ['x', 'y'] }),
      },
      { type: 'done', reason: 'stop' },
    ]);
    const onToolCallOutcome = vi.fn();
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph
        llm={provider}
        data={{ nodes: [], edges: [] }}
        onToolCallOutcome={onToolCallOutcome}
      >
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    await act(async () => handle.current!.invoke('hi'));
    expect(onToolCallOutcome).toHaveBeenCalled();
    const last =
      onToolCallOutcome.mock.calls[
        onToolCallOutcome.mock.calls.length - 1
      ][0];
    expect(last.tool).toBe('highlight');
    expect(last.appliedIds).toBeDefined();
  });

  it('surfaces controller-reported unknownIds in the highlight outcome (0.9.3)', async () => {
    setHighlight.mockReturnValue({
      appliedIds: ['x'],
      unknownIds: ['z'],
    });
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      {
        type: 'tool_call',
        name: 'highlight',
        arguments: JSON.stringify({ ids: ['x', 'z'] }),
      },
      { type: 'done', reason: 'stop' },
    ]);
    const onToolCallOutcome = vi.fn();
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph
        llm={provider}
        data={{ nodes: [], edges: [] }}
        onToolCallOutcome={onToolCallOutcome}
      >
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    await act(async () => handle.current!.invoke('hi'));
    const last =
      onToolCallOutcome.mock.calls[
        onToolCallOutcome.mock.calls.length - 1
      ][0];
    expect(last.tool).toBe('highlight');
    expect(last.appliedIds).toEqual(['x']);
    expect(last.unknownIds).toEqual(['z']);
  });

  it('surfaces controller-reported unknownIds in the focus outcome (0.9.3)', async () => {
    focusOn.mockReturnValue({
      appliedIds: [],
      unknownIds: ['ghost'],
    });
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      {
        type: 'tool_call',
        name: 'focus',
        arguments: JSON.stringify({ nodeId: 'ghost' }),
      },
      { type: 'done', reason: 'stop' },
    ]);
    const onToolCallOutcome = vi.fn();
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph
        llm={provider}
        data={{ nodes: [], edges: [] }}
        onToolCallOutcome={onToolCallOutcome}
      >
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    await act(async () => handle.current!.invoke('hi'));
    const last =
      onToolCallOutcome.mock.calls[
        onToolCallOutcome.mock.calls.length - 1
      ][0];
    expect(last.tool).toBe('focus');
    expect(last.appliedIds).toEqual([]);
    expect(last.unknownIds).toEqual(['ghost']);
  });
});

describe('useInferaGraphChat — conversationId forwarding (0.8.1)', () => {
  beforeEach(() => {
    setHighlight.mockReset();
    setHighlight.mockReturnValue({ appliedIds: [], unknownIds: [] });
    setFilter.mockReset();
    focusOn.mockReset();
    focusOn.mockReturnValue({ appliedIds: [], unknownIds: [] });
    annotate.mockReset();
    clearAnnotations.mockReset();
  });

  function makeCapturingTransport(): {
    transport: {
      chat: (
        message: string,
        opts?: import('../../src/ai/ChatEvent.js').ChatOptions,
      ) => AsyncIterable<ChatEvent>;
    };
    capturedOpts: Array<import('../../src/ai/ChatEvent.js').ChatOptions | undefined>;
  } {
    const capturedOpts: Array<import('../../src/ai/ChatEvent.js').ChatOptions | undefined> = [];
    const transport = {
      // eslint-disable-next-line require-yield
      async *chat(
        _message: string,
        opts?: import('../../src/ai/ChatEvent.js').ChatOptions,
      ): AsyncGenerator<ChatEvent, void, unknown> {
        capturedOpts.push(opts);
        yield { type: 'done', reason: 'stop' };
      },
    };
    return { transport, capturedOpts };
  }

  interface ChildHandleWithOpts {
    invoke: (
      msg: string,
      opts?: { conversationId?: string },
    ) => Promise<ChatEvent[]>;
  }

  function ChatChildWithOpts({
    handleRef,
  }: {
    handleRef: { current: ChildHandleWithOpts | null };
  }): React.ReactElement {
    const { chat } = useInferaGraphChat();
    handleRef.current = {
      invoke: async (msg: string, opts?: { conversationId?: string }) =>
        collect(chat(msg, opts)),
    };
    return <span />;
  }

  it('forwards conversationId to the transport', async () => {
    const { transport, capturedOpts } = makeCapturingTransport();
    const handle: { current: ChildHandleWithOpts | null } = { current: null };
    render(
      <InferaGraph data={{ nodes: [], edges: [] }} transport={transport}>
        <ChatChildWithOpts handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    await act(async () =>
      handle.current!.invoke('hello', { conversationId: 'conv-xyz' }),
    );
    expect(capturedOpts.length).toBe(1);
    expect(capturedOpts[0]?.conversationId).toBe('conv-xyz');
  });

  it('without conversationId calls transport with no conversationId field', async () => {
    const { transport, capturedOpts } = makeCapturingTransport();
    const handle: { current: ChildHandleWithOpts | null } = { current: null };
    render(
      <InferaGraph data={{ nodes: [], edges: [] }} transport={transport}>
        <ChatChildWithOpts handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    await act(async () => handle.current!.invoke('hello'));
    expect(capturedOpts.length).toBe(1);
    expect(capturedOpts[0]?.conversationId).toBeUndefined();
  });
});

describe('<InferaGraph onChat> callback', () => {
  beforeEach(() => {
    setHighlight.mockReset();
    setHighlight.mockReturnValue({ appliedIds: [], unknownIds: [] });
    setFilter.mockReset();
    focusOn.mockReset();
    focusOn.mockReturnValue({ appliedIds: [], unknownIds: [] });
    annotate.mockReset();
    clearAnnotations.mockReset();
  });

  it('fires for text + done events, not for tool calls', async () => {
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      { type: 'text', delta: 'hello' },
      {
        type: 'tool_call',
        name: 'highlight',
        arguments: JSON.stringify({ ids: ['x'] }),
      },
      { type: 'done', reason: 'stop' },
    ]);
    const onChat = vi.fn();
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph
        llm={provider}
        data={{ nodes: [], edges: [] }}
        onChat={onChat}
      >
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    await act(async () => handle.current!.invoke('hi'));
    const types = onChat.mock.calls.map((c) => (c[0] as ChatEvent).type);
    expect(types).toEqual(['text', 'done']);
  });
});
