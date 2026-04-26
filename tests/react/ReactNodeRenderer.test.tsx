import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeData, NodeRenderState, TooltipData } from '../../src/types.js';

const mockRender = vi.fn();
const mockUnmount = vi.fn();
const mockCreateRoot = vi.fn(() => ({
  render: mockRender,
  unmount: mockUnmount,
}));

vi.mock('react-dom/client', () => ({
  createRoot: (...args: unknown[]) => mockCreateRoot(...args),
}));

const mockCreateElement = vi.fn();
vi.mock('react', () => ({
  createElement: (...args: unknown[]) => mockCreateElement(...args),
}));

import { createReactNodeRenderFn, createReactTooltipRenderFn } from '../../src/react/ReactNodeRenderer.js';

describe('createReactNodeRenderFn', () => {
  const mockNode: NodeData = { id: 'test-node', attributes: { name: 'Test' } };
  const mockState: NodeRenderState = { isSelected: false, isHighlighted: false };
  const MockComponent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateElement.mockReturnValue('mock-element');
  });

  it('should create a NodeRenderFn from a React component', () => {
    const renderFn = createReactNodeRenderFn(MockComponent as unknown as React.ComponentType<any>);
    expect(typeof renderFn).toBe('function');
  });

  it('should render component with correct props', () => {
    const renderFn = createReactNodeRenderFn(MockComponent as unknown as React.ComponentType<any>);
    const container = document.createElement('div');

    renderFn(container, mockNode, mockState);

    expect(mockCreateRoot).toHaveBeenCalledWith(container);
    expect(mockCreateElement).toHaveBeenCalledWith(MockComponent, {
      node: mockNode,
      isSelected: false,
      isHighlighted: false,
    });
    expect(mockRender).toHaveBeenCalledWith('mock-element');
  });

  it('should return cleanup function that unmounts root', () => {
    const renderFn = createReactNodeRenderFn(MockComponent as unknown as React.ComponentType<any>);
    const container = document.createElement('div');

    const cleanup = renderFn(container, mockNode, mockState);
    expect(typeof cleanup).toBe('function');

    cleanup!();
    expect(mockUnmount).toHaveBeenCalledTimes(1);
  });

  it('should re-render into same container on second call', () => {
    const renderFn = createReactNodeRenderFn(MockComponent as unknown as React.ComponentType<any>);
    const container = document.createElement('div');

    renderFn(container, mockNode, mockState);
    expect(mockCreateRoot).toHaveBeenCalledTimes(1);

    const newState: NodeRenderState = { isSelected: true, isHighlighted: false };
    renderFn(container, mockNode, newState);
    // Should reuse the existing root, not create a new one
    expect(mockCreateRoot).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledTimes(2);

    expect(mockCreateElement).toHaveBeenLastCalledWith(MockComponent, {
      node: mockNode,
      isSelected: true,
      isHighlighted: false,
    });
  });

  it('should cleanup unmounts and removes root so next call creates a new one', () => {
    const renderFn = createReactNodeRenderFn(MockComponent as unknown as React.ComponentType<any>);
    const container = document.createElement('div');

    const cleanup = renderFn(container, mockNode, mockState);
    cleanup!();
    expect(mockUnmount).toHaveBeenCalledTimes(1);

    // After cleanup, calling renderFn again should create a new root
    renderFn(container, mockNode, mockState);
    expect(mockCreateRoot).toHaveBeenCalledTimes(2);
  });
});

describe('createReactTooltipRenderFn', () => {
  const MockTooltipComponent = vi.fn();
  const tooltipNode: NodeData = { id: 'abraham', attributes: { name: 'Abraham' } };
  const tooltipData: TooltipData = { type: 'node', node: tooltipNode };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateElement.mockReturnValue('mock-tooltip-element');
  });

  it('should return a function', () => {
    const renderFn = createReactTooltipRenderFn(MockTooltipComponent as unknown as React.ComponentType<any>);
    expect(typeof renderFn).toBe('function');
  });

  it('should call createRoot and render component with correct props', () => {
    const renderFn = createReactTooltipRenderFn(MockTooltipComponent as unknown as React.ComponentType<any>);
    const container = document.createElement('div');

    renderFn(container, tooltipData);

    expect(mockCreateRoot).toHaveBeenCalledWith(container);
    expect(mockCreateElement).toHaveBeenCalledWith(MockTooltipComponent, {
      type: 'node',
      node: tooltipNode,
      edge: undefined,
    });
    expect(mockRender).toHaveBeenCalledWith('mock-tooltip-element');
  });

  it('should return cleanup that unmounts root', () => {
    const renderFn = createReactTooltipRenderFn(MockTooltipComponent as unknown as React.ComponentType<any>);
    const container = document.createElement('div');

    const cleanup = renderFn(container, tooltipData);
    expect(typeof cleanup).toBe('function');

    cleanup();
    expect(mockUnmount).toHaveBeenCalledTimes(1);
  });

  it('should reuse root for same container', () => {
    const renderFn = createReactTooltipRenderFn(MockTooltipComponent as unknown as React.ComponentType<any>);
    const container = document.createElement('div');

    renderFn(container, tooltipData);
    expect(mockCreateRoot).toHaveBeenCalledTimes(1);

    renderFn(container, { type: 'edge', edge: { id: 'e1', sourceId: 'a', targetId: 'b', attributes: { type: 'x' } } });
    // Same container, so root should be reused
    expect(mockCreateRoot).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledTimes(2);
  });

  it('should create new root after cleanup', () => {
    const renderFn = createReactTooltipRenderFn(MockTooltipComponent as unknown as React.ComponentType<any>);
    const container = document.createElement('div');

    const cleanup = renderFn(container, tooltipData);
    cleanup();
    expect(mockUnmount).toHaveBeenCalledTimes(1);

    // After cleanup, root is null so a new one should be created
    renderFn(container, tooltipData);
    expect(mockCreateRoot).toHaveBeenCalledTimes(2);
  });
});
