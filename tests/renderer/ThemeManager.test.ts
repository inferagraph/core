import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeManager } from '../../src/renderer/ThemeManager.js';

describe('ThemeManager', () => {
  let manager: ThemeManager;
  let container: HTMLElement;

  beforeEach(() => {
    manager = new ThemeManager();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe('getProperty', () => {
    it('should return undefined for unset properties', () => {
      manager.attach(container);
      expect(manager.getProperty('--ig-nonexistent')).toBeUndefined();
    });
  });

  describe('getColor', () => {
    it('should return fallback when property is not set', () => {
      manager.attach(container);
      expect(manager.getColor('--ig-bg-color', '#fallback')).toBe('#fallback');
    });

    it('should return the CSS property value when set', () => {
      container.style.setProperty('--ig-bg-color', '#ff0000');
      manager.attach(container);
      expect(manager.getColor('--ig-bg-color', '#fallback')).toBe('#ff0000');
    });
  });

  describe('card properties', () => {
    it('should read --ig-card-bg when set', () => {
      container.style.setProperty('--ig-card-bg', 'rgba(255, 255, 255, 0.9)');
      manager.attach(container);
      expect(manager.getProperty('--ig-card-bg')).toBe('rgba(255, 255, 255, 0.9)');
    });

    it('should read --ig-card-border when set', () => {
      container.style.setProperty('--ig-card-border', 'rgba(0, 0, 0, 0.1)');
      manager.attach(container);
      expect(manager.getProperty('--ig-card-border')).toBe('rgba(0, 0, 0, 0.1)');
    });

    it('should read --ig-card-border-radius when set', () => {
      container.style.setProperty('--ig-card-border-radius', '8px');
      manager.attach(container);
      expect(manager.getProperty('--ig-card-border-radius')).toBe('8px');
    });

    it('should read --ig-card-shadow when set', () => {
      container.style.setProperty('--ig-card-shadow', '0 2px 8px rgba(0, 0, 0, 0.1)');
      manager.attach(container);
      expect(manager.getProperty('--ig-card-shadow')).toBe('0 2px 8px rgba(0, 0, 0, 0.1)');
    });
  });

  describe('refresh', () => {
    it('should re-read properties after refresh', () => {
      manager.attach(container);
      expect(manager.getProperty('--ig-card-bg')).toBeUndefined();

      container.style.setProperty('--ig-card-bg', 'rgba(30, 30, 46, 0.9)');
      manager.refresh();
      expect(manager.getProperty('--ig-card-bg')).toBe('rgba(30, 30, 46, 0.9)');
    });
  });
});
