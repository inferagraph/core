import { describe, it, expect, beforeEach } from 'vitest';
import { LabelRenderer } from '../../src/renderer/LabelRenderer.js';

describe('LabelRenderer', () => {
  let renderer: LabelRenderer;
  let container: HTMLElement;

  beforeEach(() => {
    renderer = new LabelRenderer();
    container = document.createElement('div');
    renderer.attach(container);
  });

  describe('default style', () => {
    it('should default to dot style', () => {
      expect(renderer.getStyle()).toBe('dot');
    });
  });

  describe('setStyle', () => {
    it('should change style to card', () => {
      renderer.setStyle('card');
      expect(renderer.getStyle()).toBe('card');
    });

    it('should change style back to dot', () => {
      renderer.setStyle('card');
      renderer.setStyle('dot');
      expect(renderer.getStyle()).toBe('dot');
    });

    it('should toggle CSS classes on existing labels when switching to card', () => {
      renderer.addLabel('n1', 'Alice');
      renderer.setStyle('card');
      const label = renderer.getLabel('n1')!;
      expect(label.classList.contains('ig-label-card')).toBe(true);
      expect(label.classList.contains('ig-label-dot')).toBe(false);
    });

    it('should toggle CSS classes on existing labels when switching to dot', () => {
      renderer.setStyle('card');
      renderer.addLabel('n1', 'Alice');
      renderer.setStyle('dot');
      const label = renderer.getLabel('n1')!;
      expect(label.classList.contains('ig-label-dot')).toBe(true);
      expect(label.classList.contains('ig-label-card')).toBe(false);
    });
  });

  describe('addLabel — dot style', () => {
    it('should create a label with ig-label and ig-label-dot classes', () => {
      renderer.addLabel('n1', 'Bob');
      const label = renderer.getLabel('n1')!;
      expect(label).toBeDefined();
      expect(label.className).toBe('ig-label ig-label-dot');
      expect(label.textContent).toBe('Bob');
    });

    it('should set data-node-id attribute', () => {
      renderer.addLabel('n1', 'Bob');
      const label = renderer.getLabel('n1')!;
      expect(label.dataset.nodeId).toBe('n1');
    });

    it('should append label to container', () => {
      renderer.addLabel('n1', 'Bob');
      expect(container.children.length).toBe(1);
    });

    it('should not add label when no container is attached', () => {
      const detached = new LabelRenderer();
      detached.addLabel('n1', 'Bob');
      expect(detached.getLabel('n1')).toBeUndefined();
    });
  });

  describe('addLabel — card style', () => {
    beforeEach(() => {
      renderer.setStyle('card');
    });

    it('should create a label with ig-label and ig-label-card classes', () => {
      renderer.addLabel('n1', 'Alice');
      const label = renderer.getLabel('n1')!;
      expect(label.className).toBe('ig-label ig-label-card');
    });
  });

  describe('removeLabel', () => {
    it('should remove an existing label', () => {
      renderer.addLabel('n1', 'Bob');
      renderer.removeLabel('n1');
      expect(renderer.getLabel('n1')).toBeUndefined();
      expect(container.children.length).toBe(0);
    });

    it('should not throw when removing non-existent label', () => {
      expect(() => renderer.removeLabel('nonexistent')).not.toThrow();
    });
  });

  describe('updatePosition — dot style', () => {
    it('should set transform without centering offset', () => {
      renderer.addLabel('n1', 'Bob');
      renderer.updatePosition('n1', 100, 200);
      const label = renderer.getLabel('n1')!;
      expect(label.style.transform).toBe('translate(100px, 200px)');
    });

    it('should not throw for non-existent label', () => {
      expect(() => renderer.updatePosition('nonexistent', 0, 0)).not.toThrow();
    });
  });

  describe('updatePosition — card style', () => {
    beforeEach(() => {
      renderer.setStyle('card');
    });

    it('should set transform with centering offset', () => {
      renderer.addLabel('n1', 'Alice');
      renderer.updatePosition('n1', 100, 200);
      const label = renderer.getLabel('n1')!;
      expect(label.style.transform).toBe('translate(100px, 200px) translate(-50%, -50%)');
    });
  });

  describe('clear', () => {
    it('should remove all labels', () => {
      renderer.addLabel('n1', 'Alice');
      renderer.addLabel('n2', 'Bob');
      renderer.clear();
      expect(renderer.getLabel('n1')).toBeUndefined();
      expect(renderer.getLabel('n2')).toBeUndefined();
      expect(container.children.length).toBe(0);
    });
  });

  describe('custom style', () => {
    it('should not add label when style is custom', () => {
      renderer.setStyle('custom');
      renderer.addLabel('n1', 'Alice');
      expect(renderer.getLabel('n1')).toBeUndefined();
      expect(container.children.length).toBe(0);
    });

    it('should hide existing labels when switching to custom', () => {
      renderer.addLabel('n1', 'Alice');
      renderer.addLabel('n2', 'Bob');
      renderer.setStyle('custom');
      const label1 = renderer.getLabel('n1')!;
      const label2 = renderer.getLabel('n2')!;
      expect(label1.style.display).toBe('none');
      expect(label2.style.display).toBe('none');
    });

    it('should show labels again when switching from custom to dot', () => {
      renderer.addLabel('n1', 'Alice');
      renderer.setStyle('custom');
      expect(renderer.getLabel('n1')!.style.display).toBe('none');

      renderer.setStyle('dot');
      const label = renderer.getLabel('n1')!;
      expect(label.style.display).toBe('');
      expect(label.classList.contains('ig-label-dot')).toBe(true);
    });

    it('should be no-op for updatePosition when style is custom', () => {
      renderer.addLabel('n1', 'Alice');
      renderer.setStyle('custom');
      const label = renderer.getLabel('n1')!;
      label.style.transform = '';

      renderer.updatePosition('n1', 100, 200);
      expect(label.style.transform).toBe('');
    });
  });
});
