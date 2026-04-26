import { describe, it, expect } from 'vitest';
import { TreeLayout } from '../../src/layouts/TreeLayout.js';

describe('TreeLayout', () => {
  it('should have name tree', () => {
    const layout = new TreeLayout();
    expect(layout.name).toBe('tree');
  });

  it('should compute positions for tree', () => {
    const layout = new TreeLayout();
    const positions = layout.compute(
      ['root', 'child1', 'child2'],
      [
        { sourceId: 'root', targetId: 'child1' },
        { sourceId: 'root', targetId: 'child2' },
      ],
    );
    expect(positions.size).toBe(3);
    const root = positions.get('root')!;
    const child1 = positions.get('child1')!;
    expect(root.y).toBeGreaterThan(child1.y);
  });

  it('should handle empty graph', () => {
    const layout = new TreeLayout();
    const positions = layout.compute([], []);
    expect(positions.size).toBe(0);
  });

  it('should default animated to false', () => {
    const layout = new TreeLayout();
    expect(layout.animated).toBe(false);
  });

  it('should accept animated=true override', () => {
    const layout = new TreeLayout({ animated: true });
    expect(layout.animated).toBe(true);
  });

  it('should allow changing animated at runtime via setOptions', () => {
    const layout = new TreeLayout();
    expect(layout.animated).toBe(false);

    layout.setOptions({ animated: true });
    expect(layout.animated).toBe(true);
  });
});
