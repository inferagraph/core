import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyboardManager } from '../../src/modes/KeyboardManager.js';
import type { KeyboardContext } from '../../src/modes/KeyboardManager.js';

function createMockContext(nodeIds: string[] = ['a', 'b', 'c'], neighbors: Record<string, string[]> = {}): KeyboardContext {
  return {
    focusedNodeId: null,
    getNeighborIds: (id) => neighbors[id] ?? [],
    getAllNodeIds: () => nodeIds,
    onFocusChange: vi.fn(),
    onSelect: vi.fn(),
    onDeselect: vi.fn(),
  };
}

function pressKey(container: HTMLElement, key: string, modifiers: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers });
  container.dispatchEvent(event);
}

describe('KeyboardManager', () => {
  let manager: KeyboardManager;
  let container: HTMLElement;
  let ctx: KeyboardContext;

  beforeEach(() => {
    manager = new KeyboardManager();
    container = document.createElement('div');
    ctx = createMockContext(['a', 'b', 'c'], { a: ['b', 'c'], b: ['a'], c: ['a'] });
  });

  describe('attach/detach', () => {
    it('should attach to container and set ARIA attributes', () => {
      manager.attach(container);
      expect(container.getAttribute('tabindex')).toBe('0');
      expect(container.getAttribute('role')).toBe('application');
      expect(container.getAttribute('aria-label')).toBe('Graph visualization');
      expect(manager.isAttached()).toBe(true);
    });

    it('should detach from container', () => {
      manager.attach(container);
      manager.detach();
      expect(manager.isAttached()).toBe(false);
    });
  });

  describe('Tab navigation', () => {
    it('should focus first node on Tab when nothing focused', () => {
      manager.attach(container);
      manager.setContext(ctx);
      pressKey(container, 'Tab');

      expect(ctx.onFocusChange).toHaveBeenCalledWith('a');
    });

    it('should cycle to next node on Tab', () => {
      manager.attach(container);
      manager.setContext(ctx);
      manager.setFocusedNodeId('a');

      pressKey(container, 'Tab');
      expect(ctx.onFocusChange).toHaveBeenCalledWith('b');
    });

    it('should wrap around on Tab at end', () => {
      manager.attach(container);
      manager.setContext(ctx);
      manager.setFocusedNodeId('c');

      pressKey(container, 'Tab');
      expect(ctx.onFocusChange).toHaveBeenCalledWith('a');
    });

    it('should focus last node on Shift+Tab when nothing focused', () => {
      manager.attach(container);
      manager.setContext(ctx);
      pressKey(container, 'Tab', { shiftKey: true });

      expect(ctx.onFocusChange).toHaveBeenCalledWith('c');
    });

    it('should cycle to previous node on Shift+Tab', () => {
      manager.attach(container);
      manager.setContext(ctx);
      manager.setFocusedNodeId('b');

      pressKey(container, 'Tab', { shiftKey: true });
      expect(ctx.onFocusChange).toHaveBeenCalledWith('a');
    });
  });

  describe('Arrow key navigation', () => {
    it('should navigate to first neighbor on ArrowRight', () => {
      manager.attach(container);
      manager.setContext(ctx);
      manager.setFocusedNodeId('a');

      pressKey(container, 'ArrowRight');
      expect(ctx.onFocusChange).toHaveBeenCalledWith('b');
    });

    it('should navigate to last neighbor on ArrowLeft', () => {
      manager.attach(container);
      manager.setContext(ctx);
      manager.setFocusedNodeId('a');

      pressKey(container, 'ArrowLeft');
      expect(ctx.onFocusChange).toHaveBeenCalledWith('c');
    });

    it('should not crash when no node is focused', () => {
      manager.attach(container);
      manager.setContext(ctx);
      pressKey(container, 'ArrowRight');
      // Should not throw, should not call onFocusChange
      expect(ctx.onFocusChange).not.toHaveBeenCalled();
    });
  });

  describe('Selection', () => {
    it('should select focused node on Enter', () => {
      manager.attach(container);
      manager.setContext(ctx);
      manager.setFocusedNodeId('a');

      pressKey(container, 'Enter');
      expect(ctx.onSelect).toHaveBeenCalledWith('a');
    });

    it('should select focused node on Space', () => {
      manager.attach(container);
      manager.setContext(ctx);
      manager.setFocusedNodeId('b');

      pressKey(container, ' ');
      expect(ctx.onSelect).toHaveBeenCalledWith('b');
    });

    it('should deselect all and clear focus on Escape', () => {
      manager.attach(container);
      manager.setContext(ctx);
      manager.setFocusedNodeId('a');

      pressKey(container, 'Escape');
      expect(ctx.onDeselect).toHaveBeenCalled();
      expect(ctx.onFocusChange).toHaveBeenCalledWith(null);
    });

    it('should not select when no node focused', () => {
      manager.attach(container);
      manager.setContext(ctx);
      pressKey(container, 'Enter');
      expect(ctx.onSelect).not.toHaveBeenCalled();
    });
  });

  describe('Custom bindings', () => {
    it('should register and trigger custom action', () => {
      manager.attach(container);
      manager.setContext(ctx);

      const customHandler = vi.fn();
      manager.registerAction('custom-action', customHandler);
      manager.addBinding({ key: 'd', action: 'custom-action' });

      pressKey(container, 'd');
      expect(customHandler).toHaveBeenCalled();
    });

    it('should remove bindings for action', () => {
      manager.attach(container);
      manager.setContext(ctx);

      manager.removeBindingsForAction('focus-next');
      pressKey(container, 'Tab');
      expect(ctx.onFocusChange).not.toHaveBeenCalled();
    });

    it('should return all bindings', () => {
      const bindings = manager.getBindings();
      expect(bindings.length).toBeGreaterThan(0);
      expect(bindings.some(b => b.action === 'focus-next')).toBe(true);
    });
  });

  describe('Enable/disable', () => {
    it('should not handle keys when disabled', () => {
      manager.attach(container);
      manager.setContext(ctx);
      manager.setEnabled(false);

      pressKey(container, 'Tab');
      expect(ctx.onFocusChange).not.toHaveBeenCalled();
    });

    it('should handle keys when re-enabled', () => {
      manager.attach(container);
      manager.setContext(ctx);
      manager.setEnabled(false);
      manager.setEnabled(true);

      pressKey(container, 'Tab');
      expect(ctx.onFocusChange).toHaveBeenCalled();
    });

    it('should report enabled state', () => {
      expect(manager.isEnabled()).toBe(true);
      manager.setEnabled(false);
      expect(manager.isEnabled()).toBe(false);
    });
  });

  describe('Focus management', () => {
    it('should get/set focused node', () => {
      manager.setContext(ctx);
      expect(manager.getFocusedNodeId()).toBeNull();

      manager.setFocusedNodeId('a');
      expect(manager.getFocusedNodeId()).toBe('a');
    });

    it('should notify context on focus change', () => {
      manager.setContext(ctx);
      manager.setFocusedNodeId('b');
      expect(ctx.onFocusChange).toHaveBeenCalledWith('b');
    });
  });
});
