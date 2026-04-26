import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TooltipOverlay } from '../../src/overlay/TooltipOverlay.js';
import type { NodeData, EdgeData, TooltipRenderFn, TooltipConfig } from '../../src/types.js';

const mockNode: NodeData = { id: 'abraham', attributes: { name: 'Abraham', type: 'person' } };
const mockEdge: EdgeData = { id: 'e1', sourceId: 'abraham', targetId: 'sarah', attributes: { type: 'husband_of' } };

describe('TooltipOverlay', () => {
  let overlay: TooltipOverlay;
  let parent: HTMLElement;

  beforeEach(() => {
    overlay = new TooltipOverlay();
    parent = document.createElement('div');
  });

  describe('attach', () => {
    it('should create an ig-tooltip div', () => {
      overlay.attach(parent);
      const tooltip = parent.querySelector('.ig-tooltip');
      expect(tooltip).not.toBeNull();
      expect(tooltip!.tagName).toBe('DIV');
    });

    it('should set display to none', () => {
      overlay.attach(parent);
      const tooltip = parent.querySelector('.ig-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('none');
    });

    it('should append the tooltip to the parent', () => {
      overlay.attach(parent);
      expect(parent.children.length).toBe(1);
      expect(parent.firstElementChild!.className).toBe('ig-tooltip');
    });
  });

  describe('show (backward compat)', () => {
    it('should set innerHTML and display block', () => {
      overlay.attach(parent);
      overlay.show('<strong>Hello</strong>', 10, 20);
      const tooltip = parent.querySelector('.ig-tooltip') as HTMLElement;
      expect(tooltip.innerHTML).toBe('<strong>Hello</strong>');
      expect(tooltip.style.display).toBe('block');
    });

    it('should position with left and top', () => {
      overlay.attach(parent);
      overlay.show('content', 42, 99);
      const tooltip = parent.querySelector('.ig-tooltip') as HTMLElement;
      expect(tooltip.style.left).toBe('42px');
      expect(tooltip.style.top).toBe('99px');
    });

    it('should be a no-op when not attached', () => {
      // Should not throw
      overlay.show('content', 10, 20);
    });
  });

  describe('showNode', () => {
    it('should use custom renderFn when configured', () => {
      const renderFn: TooltipRenderFn = vi.fn();
      overlay.attach(parent);
      overlay.setRenderConfig({ renderTooltip: renderFn });
      overlay.showNode(mockNode, 10, 20);

      const tooltip = parent.querySelector('.ig-tooltip') as HTMLElement;
      expect(renderFn).toHaveBeenCalledWith(tooltip, { type: 'node', node: mockNode });
    });

    it('should store cleanup from renderFn', () => {
      const cleanupFn = vi.fn();
      const renderFn: TooltipRenderFn = vi.fn(() => cleanupFn);
      overlay.attach(parent);
      overlay.setRenderConfig({ renderTooltip: renderFn });
      overlay.showNode(mockNode, 10, 20);

      // Cleanup should be called when hide is invoked
      overlay.hide();
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('should show node name as default when no custom renderer', () => {
      overlay.attach(parent);
      overlay.showNode(mockNode, 10, 20);
      const tooltip = parent.querySelector('.ig-tooltip') as HTMLElement;
      expect(tooltip.textContent).toBe('Abraham');
    });

    it('should show node id when no name attribute', () => {
      const noNameNode: NodeData = { id: 'node-123', attributes: {} };
      overlay.attach(parent);
      overlay.showNode(noNameNode, 10, 20);
      const tooltip = parent.querySelector('.ig-tooltip') as HTMLElement;
      expect(tooltip.textContent).toBe('node-123');
    });

    it('should position correctly', () => {
      overlay.attach(parent);
      overlay.showNode(mockNode, 150, 250);
      const tooltip = parent.querySelector('.ig-tooltip') as HTMLElement;
      expect(tooltip.style.left).toBe('150px');
      expect(tooltip.style.top).toBe('250px');
      expect(tooltip.style.display).toBe('block');
    });
  });

  describe('showEdge', () => {
    it('should use custom renderFn when configured', () => {
      const renderFn: TooltipRenderFn = vi.fn();
      overlay.attach(parent);
      overlay.setRenderConfig({ renderTooltip: renderFn });
      overlay.showEdge(mockEdge, 30, 40);

      const tooltip = parent.querySelector('.ig-tooltip') as HTMLElement;
      expect(renderFn).toHaveBeenCalledWith(tooltip, { type: 'edge', edge: mockEdge });
    });

    it('should show edge type as default', () => {
      overlay.attach(parent);
      overlay.showEdge(mockEdge, 30, 40);
      const tooltip = parent.querySelector('.ig-tooltip') as HTMLElement;
      expect(tooltip.textContent).toBe('husband_of');
    });

    it('should show edge id when no type attribute', () => {
      const noTypeEdge: EdgeData = { id: 'edge-99', sourceId: 'a', targetId: 'b', attributes: { type: '' } };
      overlay.attach(parent);
      overlay.showEdge(noTypeEdge, 30, 40);
      const tooltip = parent.querySelector('.ig-tooltip') as HTMLElement;
      // Empty string is falsy, so falls back to id
      expect(tooltip.textContent).toBe('edge-99');
    });
  });

  describe('hide', () => {
    it('should set display to none', () => {
      overlay.attach(parent);
      overlay.showNode(mockNode, 10, 20);
      const tooltip = parent.querySelector('.ig-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('block');

      overlay.hide();
      expect(tooltip.style.display).toBe('none');
    });

    it('should call cleanup from custom renderer', () => {
      const cleanupFn = vi.fn();
      const renderFn: TooltipRenderFn = vi.fn(() => cleanupFn);
      overlay.attach(parent);
      overlay.setRenderConfig({ renderTooltip: renderFn });
      overlay.showNode(mockNode, 10, 20);

      overlay.hide();
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('setRenderConfig', () => {
    it('should store render function from config', () => {
      const renderFn: TooltipRenderFn = vi.fn();
      overlay.attach(parent);
      overlay.setRenderConfig({ renderTooltip: renderFn });

      // Verify the stored function is used when showNode is called
      overlay.showNode(mockNode, 10, 20);
      expect(renderFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('detach', () => {
    it('should call cleanup from custom renderer', () => {
      const cleanupFn = vi.fn();
      const renderFn: TooltipRenderFn = vi.fn(() => cleanupFn);
      overlay.attach(parent);
      overlay.setRenderConfig({ renderTooltip: renderFn });
      overlay.showNode(mockNode, 10, 20);

      overlay.detach();
      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it('should remove element from DOM', () => {
      overlay.attach(parent);
      expect(parent.querySelector('.ig-tooltip')).not.toBeNull();

      overlay.detach();
      expect(parent.querySelector('.ig-tooltip')).toBeNull();
    });

    it('should set element to null so subsequent calls are no-ops', () => {
      overlay.attach(parent);
      overlay.detach();

      // These should not throw after detach
      overlay.show('test', 0, 0);
      overlay.showNode(mockNode, 0, 0);
      overlay.showEdge(mockEdge, 0, 0);
      overlay.hide();
    });
  });
});
