import { describe, it, expect } from 'vitest';
import { WebGLRenderer } from '../../src/renderer/WebGLRenderer.js';

describe('WebGLRenderer', () => {
  it('should attach to container', () => {
    const renderer = new WebGLRenderer();
    const container = document.createElement('div');
    renderer.attach(container);
    expect(renderer.getContainer()).toBe(container);
  });

  it('should detach', () => {
    const renderer = new WebGLRenderer();
    const container = document.createElement('div');
    renderer.attach(container);
    renderer.detach();
    expect(renderer.getContainer()).toBeNull();
  });

  it('should expose theme manager', () => {
    const renderer = new WebGLRenderer();
    expect(renderer.getThemeManager()).toBeDefined();
  });
});
