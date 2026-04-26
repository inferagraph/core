import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { Minimap } from '../../src/overlay/Minimap.js';

// Mock canvas context since jsdom doesn't support Canvas 2D
const mockCtx = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
};

// Patch HTMLCanvasElement.prototype.getContext
const origGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  vi.restoreAllMocks();
  // Reset mock call counts
  mockCtx.clearRect.mockClear();
  mockCtx.fillRect.mockClear();
  mockCtx.strokeRect.mockClear();
  mockCtx.beginPath.mockClear();
  mockCtx.arc.mockClear();
  mockCtx.fill.mockClear();
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as any;
});

// Restore after all tests
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
});

describe('Minimap', () => {
  it('should attach canvas to container', () => {
    const minimap = new Minimap();
    const container = document.createElement('div');
    minimap.attach(container);

    expect(container.querySelector('canvas')).toBeTruthy();
    expect(minimap.isAttached()).toBe(true);
  });

  it('should detach and remove canvas', () => {
    const minimap = new Minimap();
    const container = document.createElement('div');
    minimap.attach(container);
    minimap.detach();

    expect(container.querySelector('canvas')).toBeNull();
    expect(minimap.isAttached()).toBe(false);
  });

  it('should use default config values', () => {
    const minimap = new Minimap();
    const container = document.createElement('div');
    minimap.attach(container);
    const canvas = minimap.getCanvas()!;

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(150);
  });

  it('should use custom config values', () => {
    const minimap = new Minimap({ width: 300, height: 200 });
    const container = document.createElement('div');
    minimap.attach(container);
    const canvas = minimap.getCanvas()!;

    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(200);
  });

  it('should render all nodes', () => {
    const minimap = new Minimap();
    const container = document.createElement('div');
    minimap.attach(container);

    const positions = new Map([
      ['n1', { x: 0, y: 0 }],
      ['n2', { x: 100, y: 100 }],
      ['n3', { x: 50, y: 50 }],
    ]);
    minimap.updatePositions(positions);

    expect(minimap.getNodeCount()).toBe(3);
    // Arc should be called once per node
    expect(mockCtx.arc).toHaveBeenCalledTimes(3);
  });

  it('should render viewport rectangle', () => {
    const minimap = new Minimap();
    const container = document.createElement('div');
    minimap.attach(container);

    const positions = new Map([['n1', { x: 0, y: 0 }]]);
    minimap.updatePositions(positions);
    minimap.updateViewport({ x: 10, y: 10, width: 50, height: 50 });

    // fillRect called for background + viewport
    expect(mockCtx.fillRect).toHaveBeenCalled();
    expect(mockCtx.strokeRect).toHaveBeenCalled();
  });

  it('should call onNavigate when clicked', () => {
    const minimap = new Minimap();
    const container = document.createElement('div');
    minimap.attach(container);

    const positions = new Map([
      ['n1', { x: 0, y: 0 }],
      ['n2', { x: 100, y: 100 }],
    ]);
    minimap.updatePositions(positions);

    const navigateFn = vi.fn();
    minimap.setOnNavigate(navigateFn);

    // Simulate click
    const canvas = minimap.getCanvas()!;
    // Mock getBoundingClientRect
    canvas.getBoundingClientRect = vi.fn().mockReturnValue({ left: 0, top: 0 });
    const clickEvent = new MouseEvent('click', { clientX: 100, clientY: 75 });
    canvas.dispatchEvent(clickEvent);

    expect(navigateFn).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
  });

  it('should not crash when rendering with no positions', () => {
    const minimap = new Minimap();
    const container = document.createElement('div');
    minimap.attach(container);
    minimap.render();
    // Should not throw
    expect(mockCtx.clearRect).toHaveBeenCalled();
  });

  it('should handle detach when not attached', () => {
    const minimap = new Minimap();
    // Should not throw
    minimap.detach();
    expect(minimap.isAttached()).toBe(false);
  });

  it('should return null canvas when not attached', () => {
    const minimap = new Minimap();
    expect(minimap.getCanvas()).toBeNull();
  });

  it('should return 0 node count when no positions set', () => {
    const minimap = new Minimap();
    expect(minimap.getNodeCount()).toBe(0);
  });
});
