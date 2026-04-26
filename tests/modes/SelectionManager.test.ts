import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SelectionManager } from '../../src/modes/SelectionManager.js';

describe('SelectionManager', () => {
  let manager: SelectionManager;

  beforeEach(() => {
    manager = new SelectionManager();
  });

  describe('select', () => {
    it('should select a single node in replace mode', () => {
      manager.select('a');
      expect(manager.isSelected('a')).toBe(true);
      expect(manager.count).toBe(1);
    });

    it('should replace previous selection in replace mode', () => {
      manager.select('a');
      manager.select('b');
      expect(manager.isSelected('a')).toBe(false);
      expect(manager.isSelected('b')).toBe(true);
      expect(manager.count).toBe(1);
    });

    it('should add to selection in add mode (Shift+click)', () => {
      manager.select('a');
      manager.select('b', 'add');
      expect(manager.isSelected('a')).toBe(true);
      expect(manager.isSelected('b')).toBe(true);
      expect(manager.count).toBe(2);
    });

    it('should toggle node into selection in toggle mode (Ctrl+click)', () => {
      manager.select('a', 'toggle');
      expect(manager.isSelected('a')).toBe(true);
    });

    it('should toggle node out of selection in toggle mode', () => {
      manager.select('a');
      manager.select('a', 'toggle');
      expect(manager.isSelected('a')).toBe(false);
      expect(manager.count).toBe(0);
    });
  });

  describe('selectMany', () => {
    it('should select multiple nodes in replace mode', () => {
      manager.select('x');
      manager.selectMany(['a', 'b', 'c'], 'replace');
      expect(manager.isSelected('x')).toBe(false);
      expect(manager.isSelected('a')).toBe(true);
      expect(manager.isSelected('b')).toBe(true);
      expect(manager.isSelected('c')).toBe(true);
      expect(manager.count).toBe(3);
    });

    it('should add all to existing selection in add mode', () => {
      manager.select('x');
      manager.selectMany(['a', 'b'], 'add');
      expect(manager.isSelected('x')).toBe(true);
      expect(manager.isSelected('a')).toBe(true);
      expect(manager.isSelected('b')).toBe(true);
      expect(manager.count).toBe(3);
    });

    it('should toggle each node in toggle mode', () => {
      manager.select('a');
      manager.select('b', 'add');
      // a and b are selected; toggle [a, c] → a removed, c added
      manager.selectMany(['a', 'c'], 'toggle');
      expect(manager.isSelected('a')).toBe(false);
      expect(manager.isSelected('b')).toBe(true);
      expect(manager.isSelected('c')).toBe(true);
      expect(manager.count).toBe(2);
    });
  });

  describe('deselect', () => {
    it('should remove a specific node from selection', () => {
      manager.selectMany(['a', 'b', 'c']);
      manager.deselect('b');
      expect(manager.isSelected('b')).toBe(false);
      expect(manager.count).toBe(2);
    });
  });

  describe('clearSelection', () => {
    it('should clear all selected nodes', () => {
      manager.selectMany(['a', 'b', 'c']);
      manager.clearSelection();
      expect(manager.count).toBe(0);
      expect(manager.isSelected('a')).toBe(false);
    });

    it('should not fire change callback if already empty', () => {
      const callback = vi.fn();
      manager.onChange(callback);
      manager.clearSelection();
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('isSelected', () => {
    it('should return true for selected node', () => {
      manager.select('a');
      expect(manager.isSelected('a')).toBe(true);
    });

    it('should return false for unselected node', () => {
      expect(manager.isSelected('nonexistent')).toBe(false);
    });
  });

  describe('getSelected', () => {
    it('should return a copy, not the internal set', () => {
      manager.selectMany(['a', 'b']);
      const selected = manager.getSelected();
      selected.add('c');
      expect(manager.isSelected('c')).toBe(false);
      expect(manager.count).toBe(2);
    });
  });

  describe('count', () => {
    it('should return 0 initially', () => {
      expect(manager.count).toBe(0);
    });

    it('should return correct count after operations', () => {
      manager.selectMany(['a', 'b', 'c']);
      expect(manager.count).toBe(3);
      manager.deselect('a');
      expect(manager.count).toBe(2);
    });
  });

  describe('onChange / offChange', () => {
    it('should fire callback on selection change', () => {
      const callback = vi.fn();
      manager.onChange(callback);
      manager.select('a');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(new Set(['a']));
    });

    it('should fire callback with snapshot (not reference)', () => {
      let capturedSet: Set<string> | null = null;
      manager.onChange((selected) => {
        capturedSet = selected;
      });
      manager.select('a');
      manager.select('b');
      // The captured set from the second call should have only 'b' (replace mode)
      expect(capturedSet).toEqual(new Set(['b']));
    });

    it('should remove callback with offChange', () => {
      const callback = vi.fn();
      manager.onChange(callback);
      manager.select('a');
      expect(callback).toHaveBeenCalledTimes(1);

      manager.offChange(callback);
      manager.select('b');
      expect(callback).toHaveBeenCalledTimes(1); // not called again
    });
  });

  describe('selectByRect', () => {
    it('should select nodes within the rectangle', () => {
      const positions = new Map<string, { x: number; y: number }>([
        ['a', { x: 10, y: 10 }],
        ['b', { x: 50, y: 50 }],
        ['c', { x: 200, y: 200 }],
      ]);

      manager.selectByRect(
        { startX: 0, startY: 0, endX: 100, endY: 100 },
        positions
      );

      expect(manager.isSelected('a')).toBe(true);
      expect(manager.isSelected('b')).toBe(true);
      expect(manager.isSelected('c')).toBe(false);
      expect(manager.count).toBe(2);
    });

    it('should ignore nodes outside the rectangle', () => {
      const positions = new Map<string, { x: number; y: number }>([
        ['a', { x: 150, y: 150 }],
        ['b', { x: 300, y: 300 }],
      ]);

      manager.selectByRect(
        { startX: 0, startY: 0, endX: 100, endY: 100 },
        positions
      );

      expect(manager.count).toBe(0);
    });

    it('should handle inverted rectangle coordinates', () => {
      const positions = new Map<string, { x: number; y: number }>([
        ['a', { x: 50, y: 50 }],
      ]);

      // endX < startX, endY < startY
      manager.selectByRect(
        { startX: 100, startY: 100, endX: 0, endY: 0 },
        positions
      );

      expect(manager.isSelected('a')).toBe(true);
    });

    it('should add to existing selection in add mode', () => {
      manager.select('x');
      const positions = new Map<string, { x: number; y: number }>([
        ['a', { x: 50, y: 50 }],
      ]);

      manager.selectByRect(
        { startX: 0, startY: 0, endX: 100, endY: 100 },
        positions,
        'add'
      );

      expect(manager.isSelected('x')).toBe(true);
      expect(manager.isSelected('a')).toBe(true);
      expect(manager.count).toBe(2);
    });
  });
});
