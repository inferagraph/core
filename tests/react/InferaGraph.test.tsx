import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy on SceneController so we can assert the React layer wires it correctly
// without exercising the full Three.js stack inside jsdom.
const attach = vi.fn();
const detach = vi.fn();
const syncFromStore = vi.fn();
const setLayout = vi.fn();
const setNodeRender = vi.fn();
const setTooltip = vi.fn();
const setIncomingEdgeLabels = vi.fn();
const setOutgoingEdgeLabels = vi.fn();
const setTreeFilter = vi.fn();
const resize = vi.fn();

let lastConstructorArgs: unknown[] = [];

vi.mock('../../src/renderer/SceneController.js', () => ({
  SceneController: vi.fn().mockImplementation((...args: unknown[]) => {
    lastConstructorArgs = args;
    return {
      attach,
      detach,
      syncFromStore,
      setLayout,
      setNodeRender,
      setTooltip,
      setIncomingEdgeLabels,
      setOutgoingEdgeLabels,
      setTreeFilter,
      resize,
    };
  }),
}));

import { render, waitFor, act } from '@testing-library/react';
import { InferaGraph } from '../../src/react/InferaGraph.js';
import type { GraphData } from '../../src/types.js';

const sampleData: GraphData = {
  nodes: [
    { id: 'a', attributes: { name: 'A' } },
    { id: 'b', attributes: { name: 'B' } },
  ],
  edges: [
    { id: 'e1', sourceId: 'a', targetId: 'b', attributes: { type: 'rel' } },
  ],
};

describe('InferaGraph', () => {
  beforeEach(() => {
    attach.mockReset();
    detach.mockReset();
    syncFromStore.mockReset();
    setLayout.mockReset();
    setNodeRender.mockReset();
    setTooltip.mockReset();
    setIncomingEdgeLabels.mockReset();
    setOutgoingEdgeLabels.mockReset();
    setTreeFilter.mockReset();
    resize.mockReset();
    lastConstructorArgs = [];
  });

  it('renders the ig-container element', () => {
    const { container } = render(<InferaGraph />);
    expect(container.querySelector('.ig-container')).toBeTruthy();
  });

  it('forwards className to the container', () => {
    const { container } = render(<InferaGraph className="custom" />);
    expect(container.querySelector('.ig-container.custom')).toBeTruthy();
  });

  it('mounts a SceneController and attaches it to the container', async () => {
    const { container } = render(<InferaGraph data={sampleData} />);
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));
    expect(attach.mock.calls[0][0]).toBe(container.querySelector('.ig-container'));
  });

  it('passes the layout prop to the SceneController constructor', async () => {
    render(<InferaGraph data={sampleData} layout="tree" />);
    await waitFor(() => expect(lastConstructorArgs.length).toBeGreaterThan(0));
    const opts = lastConstructorArgs[0] as { layout: string };
    expect(opts.layout).toBe('tree');
  });

  it('passes nodeColors / edgeColors / palette / colorFns to the SceneController', async () => {
    const nodeColors = { person: '#3b82f6' };
    const edgeColors = { father_of: '#06b6d4' };
    const palette = ['#aaaaaa', '#bbbbbb'];
    const nodeColorFn = () => '#000000';
    const edgeColorFn = () => '#ffffff';
    render(
      <InferaGraph
        data={sampleData}
        nodeColors={nodeColors}
        edgeColors={edgeColors}
        palette={palette}
        nodeColorFn={nodeColorFn}
        edgeColorFn={edgeColorFn}
      />,
    );
    await waitFor(() => expect(lastConstructorArgs.length).toBeGreaterThan(0));
    const opts = lastConstructorArgs[0] as {
      nodeColors: unknown;
      edgeColors: unknown;
      palette: unknown;
      nodeColorFn: unknown;
      edgeColorFn: unknown;
    };
    expect(opts.nodeColors).toBe(nodeColors);
    expect(opts.edgeColors).toBe(edgeColors);
    expect(opts.palette).toBe(palette);
    expect(opts.nodeColorFn).toBe(nodeColorFn);
    expect(opts.edgeColorFn).toBe(edgeColorFn);
  });

  it('forwards data to the GraphProvider so syncFromStore runs after isReady', async () => {
    render(<InferaGraph data={sampleData} />);
    await waitFor(() => expect(syncFromStore).toHaveBeenCalled());
  });

  it('passes incomingEdgeLabels / outgoingEdgeLabels to the SceneController', async () => {
    const incomingEdgeLabels = { father_of: 'Son of', mother_of: 'Son of' };
    const outgoingEdgeLabels = { father_of: 'Father of' };
    render(
      <InferaGraph
        data={sampleData}
        incomingEdgeLabels={incomingEdgeLabels}
        outgoingEdgeLabels={outgoingEdgeLabels}
      />,
    );
    await waitFor(() => expect(lastConstructorArgs.length).toBeGreaterThan(0));
    const opts = lastConstructorArgs[0] as {
      incomingEdgeLabels: unknown;
      outgoingEdgeLabels: unknown;
    };
    expect(opts.incomingEdgeLabels).toBe(incomingEdgeLabels);
    expect(opts.outgoingEdgeLabels).toBe(outgoingEdgeLabels);
  });

  it('pushes edge-label-map changes into the controller without remounting', async () => {
    const initial = { father_of: 'Son of' };
    const updated = { father_of: 'Child of' };
    const { rerender } = render(
      <InferaGraph data={sampleData} incomingEdgeLabels={initial} />,
    );
    await waitFor(() =>
      expect(setIncomingEdgeLabels).toHaveBeenLastCalledWith(initial),
    );
    rerender(<InferaGraph data={sampleData} incomingEdgeLabels={updated} />);
    await waitFor(() =>
      expect(setIncomingEdgeLabels).toHaveBeenLastCalledWith(updated),
    );
    // Critically: the controller is *not* re-attached.
    expect(attach).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
  });

  it('still syncs when no data is provided so an empty store renders cleanly', async () => {
    // GraphProvider treats "no adapter" as immediately ready, so syncFromStore
    // runs once against an empty store. This is intentional — it lets the
    // renderer paint a blank canvas immediately rather than waiting forever.
    render(<InferaGraph />);
    await waitFor(() => expect(syncFromStore).toHaveBeenCalledTimes(1));
  });

  it('detaches the controller on unmount', async () => {
    const { unmount } = render(<InferaGraph data={sampleData} />);
    await waitFor(() => expect(attach).toHaveBeenCalled());
    unmount();
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it('pushes layout-mode changes into the controller without remounting', async () => {
    const { rerender } = render(<InferaGraph data={sampleData} layout="graph" />);
    await waitFor(() => expect(setLayout).toHaveBeenLastCalledWith('graph'));

    rerender(<InferaGraph data={sampleData} layout="tree" />);
    await waitFor(() => expect(setLayout).toHaveBeenLastCalledWith('tree'));
    // Critically: the controller is *not* re-attached.
    expect(attach).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
  });

  it('does not re-mount the controller when the parent re-renders with the same data + props (bidirectional edges)', async () => {
    // Regression for the runaway-render stack overflow seen on graphs with
    // bidirectional edges (Bible Graph's `father_of` ↔ `son_of`). Repeated
    // parent re-renders must not tear down + rebuild the SceneController —
    // a stable context value from `GraphProvider` is what makes this hold.
    const familyData: GraphData = {
      nodes: [
        { id: 'abraham', attributes: { name: 'Abraham', type: 'person' } },
        { id: 'isaac', attributes: { name: 'Isaac', type: 'person' } },
      ],
      edges: [
        { id: 'e1', sourceId: 'abraham', targetId: 'isaac', attributes: { type: 'father_of' } },
        { id: 'e2', sourceId: 'isaac', targetId: 'abraham', attributes: { type: 'son_of' } },
      ],
    };
    const incoming = { father_of: 'Son of', son_of: 'Father of' };
    const outgoing = { father_of: 'Father of', son_of: 'Son of' };
    const { rerender } = render(
      <InferaGraph
        data={familyData}
        incomingEdgeLabels={incoming}
        outgoingEdgeLabels={outgoing}
      />,
    );
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));

    // Three forced re-renders with the same prop references — the controller
    // must mount exactly once. Without the GraphProvider context-value
    // memoization, the inner `useEffect([store, renderer])` would fire on
    // every render and tear down + rebuild the controller, which is the
    // pathology that produced `RangeError: Maximum call stack size exceeded`.
    for (let i = 0; i < 3; i++) {
      rerender(
        <InferaGraph
          data={familyData}
          incomingEdgeLabels={incoming}
          outgoingEdgeLabels={outgoing}
        />,
      );
    }

    expect(attach).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
  });

  it('observes container resize and forwards to the controller', async () => {
    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();
    let capturedCb: ResizeObserverCallback | null = null;

    const RealResizeObserver = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = vi
      .fn()
      .mockImplementation((cb: ResizeObserverCallback) => {
        capturedCb = cb;
        return { observe: observeSpy, disconnect: disconnectSpy, unobserve: vi.fn() };
      });

    try {
      const { unmount } = render(<InferaGraph data={sampleData} />);
      await waitFor(() => expect(observeSpy).toHaveBeenCalled());

      // Simulate a resize callback firing.
      act(() => {
        capturedCb?.([], {} as ResizeObserver);
      });
      expect(resize).toHaveBeenCalled();

      unmount();
      expect(disconnectSpy).toHaveBeenCalled();
    } finally {
      (globalThis as unknown as { ResizeObserver: typeof RealResizeObserver }).ResizeObserver =
        RealResizeObserver;
    }
  });
});
