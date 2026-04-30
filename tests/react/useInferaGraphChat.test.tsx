import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy on SceneController so we can assert tool-call dispatch goes through it.
const setHighlight = vi.fn();
const setFilter = vi.fn();
const focusOn = vi.fn();
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
    setFilter.mockReset();
    focusOn.mockReset();
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

describe('<InferaGraph onChat> callback', () => {
  beforeEach(() => {
    setHighlight.mockReset();
    setFilter.mockReset();
    focusOn.mockReset();
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
