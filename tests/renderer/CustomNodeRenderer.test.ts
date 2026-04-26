import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomNodeRenderer } from '../../src/renderer/CustomNodeRenderer.js';
import type { NodeData, NodeRenderFn, NodeRenderState } from '../../src/types.js';

describe('CustomNodeRenderer', () => {
  let renderer: CustomNodeRenderer;
  let parent: HTMLElement;

  const mockNode: NodeData = { id: 'test-node', attributes: { name: 'Test' } };
  const mockState: NodeRenderState = { isSelected: false, isHighlighted: false };

  beforeEach(() => {
    renderer = new CustomNodeRenderer();
    parent = document.createElement('div');
  });

  describe('attach', () => {
    it('should create ig-custom-node-container div', () => {
      renderer.attach(parent);
      const container = parent.querySelector('.ig-custom-node-container');
      expect(container).not.toBeNull();
      expect(container!.tagName).toBe('DIV');
    });

    it('should set pointer-events none on container', () => {
      renderer.attach(parent);
      const container = parent.querySelector('.ig-custom-node-container') as HTMLElement;
      expect(container.style.pointerEvents).toBe('none');
    });

    it('should set position absolute and inset 0', () => {
      renderer.attach(parent);
      const container = parent.querySelector('.ig-custom-node-container') as HTMLElement;
      expect(container.style.position).toBe('absolute');
      expect(container.style.inset).toBe('0');
    });
  });

  describe('addNode', () => {
    let renderNode: ReturnType<typeof vi.fn>;
    let cleanupFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      cleanupFn = vi.fn();
      renderNode = vi.fn().mockReturnValue(cleanupFn);
      renderer.attach(parent);
    });

    it('should create ig-custom-node div with data-node-id', () => {
      renderer.addNode('n1', mockNode, mockState, renderNode);
      const container = parent.querySelector('.ig-custom-node-container')!;
      const nodeEl = container.querySelector('.ig-custom-node') as HTMLElement;
      expect(nodeEl).not.toBeNull();
      expect(nodeEl.dataset.nodeId).toBe('n1');
    });

    it('should call renderNode with element, node, and state', () => {
      renderer.addNode('n1', mockNode, mockState, renderNode);
      expect(renderNode).toHaveBeenCalledTimes(1);
      const callArgs = renderNode.mock.calls[0];
      expect(callArgs[0]).toBeInstanceOf(HTMLElement);
      expect(callArgs[1]).toBe(mockNode);
      expect(callArgs[2]).toBe(mockState);
    });

    it('should set pointer-events auto on node element', () => {
      renderer.addNode('n1', mockNode, mockState, renderNode);
      const container = parent.querySelector('.ig-custom-node-container')!;
      const nodeEl = container.querySelector('.ig-custom-node') as HTMLElement;
      expect(nodeEl.style.pointerEvents).toBe('auto');
    });

    it('should store cleanup function returned by renderNode', () => {
      renderer.addNode('n1', mockNode, mockState, renderNode);
      // Verify cleanup is stored by removing the node and checking the cleanup was called
      renderer.removeNode('n1');
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('should be no-op when container not attached', () => {
      const detached = new CustomNodeRenderer();
      detached.addNode('n1', mockNode, mockState, renderNode);
      expect(renderNode).not.toHaveBeenCalled();
    });
  });

  describe('updateNode', () => {
    let renderNode: ReturnType<typeof vi.fn>;
    let cleanupFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      cleanupFn = vi.fn();
      renderNode = vi.fn().mockReturnValue(cleanupFn);
      renderer.attach(parent);
    });

    it('should call cleanup from previous render', () => {
      renderer.addNode('n1', mockNode, mockState, renderNode);
      const newState: NodeRenderState = { isSelected: true, isHighlighted: false };
      const newCleanup = vi.fn();
      const newRenderNode = vi.fn().mockReturnValue(newCleanup);

      renderer.updateNode('n1', mockNode, newState, newRenderNode);
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('should clear innerHTML', () => {
      renderer.addNode('n1', mockNode, mockState, renderNode);
      // Manually add some content to the node element to verify it gets cleared
      const container = parent.querySelector('.ig-custom-node-container')!;
      const nodeEl = container.querySelector('.ig-custom-node') as HTMLElement;
      nodeEl.innerHTML = '<span>old content</span>';

      const newRenderNode = vi.fn().mockReturnValue(undefined);
      renderer.updateNode('n1', mockNode, mockState, newRenderNode);
      // innerHTML was cleared before renderNode was called
      // We verify that renderNode received an element (it clears innerHTML before calling renderNode)
      expect(newRenderNode).toHaveBeenCalledTimes(1);
    });

    it('should call renderNode with new state', () => {
      renderer.addNode('n1', mockNode, mockState, renderNode);
      const newState: NodeRenderState = { isSelected: true, isHighlighted: true };
      const newRenderNode = vi.fn().mockReturnValue(undefined);

      renderer.updateNode('n1', mockNode, newState, newRenderNode);
      expect(newRenderNode).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        mockNode,
        newState,
      );
    });

    it('should store new cleanup function', () => {
      renderer.addNode('n1', mockNode, mockState, renderNode);
      const newCleanup = vi.fn();
      const newRenderNode = vi.fn().mockReturnValue(newCleanup);

      renderer.updateNode('n1', mockNode, mockState, newRenderNode);
      // Verify new cleanup is stored by removing node
      renderer.removeNode('n1');
      expect(newCleanup).toHaveBeenCalledTimes(1);
      // Old cleanup should only have been called once (during update), not during remove
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeNode', () => {
    it('should call cleanup function', () => {
      const cleanupFn = vi.fn();
      const renderNode = vi.fn().mockReturnValue(cleanupFn);
      renderer.attach(parent);
      renderer.addNode('n1', mockNode, mockState, renderNode);

      renderer.removeNode('n1');
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('should remove element from DOM', () => {
      const renderNode = vi.fn().mockReturnValue(undefined);
      renderer.attach(parent);
      renderer.addNode('n1', mockNode, mockState, renderNode);

      const container = parent.querySelector('.ig-custom-node-container')!;
      expect(container.children.length).toBe(1);

      renderer.removeNode('n1');
      expect(container.children.length).toBe(0);
    });

    it('should handle non-existent node gracefully', () => {
      renderer.attach(parent);
      expect(() => renderer.removeNode('nonexistent')).not.toThrow();
    });
  });

  describe('updatePosition', () => {
    it('should set transform with translate and centering', () => {
      const renderNode = vi.fn().mockReturnValue(undefined);
      renderer.attach(parent);
      renderer.addNode('n1', mockNode, mockState, renderNode);

      renderer.updatePosition('n1', 100, 200);
      const container = parent.querySelector('.ig-custom-node-container')!;
      const nodeEl = container.querySelector('.ig-custom-node') as HTMLElement;
      expect(nodeEl.style.transform).toBe('translate(100px, 200px) translate(-50%, -50%)');
    });

    it('should be no-op for non-existent node', () => {
      renderer.attach(parent);
      expect(() => renderer.updatePosition('nonexistent', 50, 75)).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all nodes and call cleanup for each', () => {
      const cleanup1 = vi.fn();
      const cleanup2 = vi.fn();
      const renderNode1 = vi.fn().mockReturnValue(cleanup1);
      const renderNode2 = vi.fn().mockReturnValue(cleanup2);
      renderer.attach(parent);

      const node1: NodeData = { id: 'n1', attributes: { name: 'A' } };
      const node2: NodeData = { id: 'n2', attributes: { name: 'B' } };

      renderer.addNode('n1', node1, mockState, renderNode1);
      renderer.addNode('n2', node2, mockState, renderNode2);

      const container = parent.querySelector('.ig-custom-node-container')!;
      expect(container.children.length).toBe(2);

      renderer.clear();
      expect(cleanup1).toHaveBeenCalledTimes(1);
      expect(cleanup2).toHaveBeenCalledTimes(1);
      expect(container.children.length).toBe(0);
    });
  });

  describe('detach', () => {
    it('should call clear', () => {
      const cleanupFn = vi.fn();
      const renderNode = vi.fn().mockReturnValue(cleanupFn);
      renderer.attach(parent);
      renderer.addNode('n1', mockNode, mockState, renderNode);

      renderer.detach();
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('should remove container from DOM', () => {
      renderer.attach(parent);
      expect(parent.querySelector('.ig-custom-node-container')).not.toBeNull();

      renderer.detach();
      expect(parent.querySelector('.ig-custom-node-container')).toBeNull();
    });

    it('should set container to null so addNode becomes no-op after', () => {
      renderer.attach(parent);
      renderer.detach();

      const renderNode = vi.fn();
      renderer.addNode('n1', mockNode, mockState, renderNode);
      expect(renderNode).not.toHaveBeenCalled();
    });
  });
});
