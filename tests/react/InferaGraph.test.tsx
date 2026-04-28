import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy on SceneController so we can assert the React layer wires it correctly
// without exercising the full Three.js stack inside jsdom.
const attach = vi.fn();
const detach = vi.fn();
const syncFromStore = vi.fn();
const setLayout = vi.fn();
const setNodeRender = vi.fn();
const setTooltip = vi.fn();
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

  it('forwards data to the GraphProvider so syncFromStore runs after isReady', async () => {
    render(<InferaGraph data={sampleData} />);
    await waitFor(() => expect(syncFromStore).toHaveBeenCalled());
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
