import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 5 Subagent B: prop wiring + chat-event dispatch for the
 * inferred-edge overlay. Mirrors the spying strategy used by the
 * sibling InferaGraph React tests.
 */
const setInferredEdgeVisibility = vi.fn();

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
    setFilter: vi.fn(),
    setHighlight: vi.fn(),
    focusOn: vi.fn(),
    annotate: vi.fn(),
    clearAnnotations: vi.fn(),
    resize: vi.fn(),
    setInferredEdgeVisibility,
  })),
}));

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { InferaGraph } from '../../src/react/InferaGraph.js';
import { useInferaGraphChat } from '../../src/react/useInferaGraphChat.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import type { GraphData } from '../../src/types.js';
import type { ChatEvent } from '../../src/ai/ChatEvent.js';
import type { LLMStreamEvent } from '../../src/ai/LLMProvider.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

const sampleData: GraphData = {
  nodes: [
    { id: 'a', attributes: { name: 'A' } },
    { id: 'b', attributes: { name: 'B' } },
  ],
  edges: [
    { id: 'e1', sourceId: 'a', targetId: 'b', attributes: { type: 'rel' } },
  ],
};

describe('InferaGraph: inferred-edge overlay wiring', () => {
  beforeEach(() => {
    setInferredEdgeVisibility.mockReset();
  });

  it('defaults showInferredEdges to false (overlay hidden)', async () => {
    render(<InferaGraph data={sampleData} />);
    await waitFor(() =>
      expect(setInferredEdgeVisibility).toHaveBeenLastCalledWith(false),
    );
  });

  it('forwards an explicit showInferredEdges=true to the controller', async () => {
    render(<InferaGraph data={sampleData} showInferredEdges />);
    await waitFor(() =>
      expect(setInferredEdgeVisibility).toHaveBeenLastCalledWith(true),
    );
  });

  it('pushes prop changes into the controller without remounting', async () => {
    const { rerender } = render(
      <InferaGraph data={sampleData} showInferredEdges={false} />,
    );
    await waitFor(() =>
      expect(setInferredEdgeVisibility).toHaveBeenLastCalledWith(false),
    );
    rerender(<InferaGraph data={sampleData} showInferredEdges />);
    await waitFor(() =>
      expect(setInferredEdgeVisibility).toHaveBeenLastCalledWith(true),
    );
    rerender(<InferaGraph data={sampleData} showInferredEdges={false} />);
    await waitFor(() =>
      expect(setInferredEdgeVisibility).toHaveBeenLastCalledWith(false),
    );
  });

  it('dispatches set_inferred_visibility chat events to the controller', async () => {
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

    // Drive the LLM provider to emit a `set_inferred_visibility` tool call.
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      { type: 'text', delta: 'showing inferred edges ' },
      {
        type: 'tool_call',
        name: 'set_inferred_visibility',
        arguments: JSON.stringify({ visible: true }),
      },
      { type: 'done', reason: 'stop' },
    ]);
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph llm={provider} data={sampleData}>
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    // Reset so we ignore the constructor-time visibility=false call.
    setInferredEdgeVisibility.mockClear();
    await act(async () => {
      await handle.current!.invoke('show me inferred relationships');
    });
    // Subagent A's parseToolCall maps the tool call to a
    // `set_inferred_visibility` ChatEvent variant; the React dispatch
    // case added in Subagent B routes it to the controller.
    expect(setInferredEdgeVisibility).toHaveBeenCalledWith(true);
  });

  it('dispatches set_inferred_visibility(false) through the chat path', async () => {
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
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      {
        type: 'tool_call',
        name: 'set_inferred_visibility',
        arguments: JSON.stringify({ visible: false }),
      },
      { type: 'done', reason: 'stop' },
    ]);
    const handle: { current: ChildHandle | null } = { current: null };
    render(
      <InferaGraph llm={provider} data={sampleData} showInferredEdges>
        <ChatChild handleRef={handle} />
      </InferaGraph>,
    );
    await waitFor(() => expect(handle.current).not.toBeNull());
    setInferredEdgeVisibility.mockClear();
    await act(async () => {
      await handle.current!.invoke('hide inferred edges');
    });
    expect(setInferredEdgeVisibility).toHaveBeenCalledWith(false);
  });

  it('does not remount the controller when showInferredEdges flips', async () => {
    const { rerender } = render(<InferaGraph data={sampleData} />);
    await waitFor(() => expect(setInferredEdgeVisibility).toHaveBeenCalled());
    setInferredEdgeVisibility.mockClear();
    rerender(<InferaGraph data={sampleData} showInferredEdges />);
    await waitFor(() =>
      expect(setInferredEdgeVisibility).toHaveBeenLastCalledWith(true),
    );
  });
});
