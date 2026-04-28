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

  it('should not blow the stack on bidirectional edges (cycle)', () => {
    // Bible Graph emits gender-specific reciprocal edges, e.g.
    //   adam -> father_of -> cain
    //   cain -> son_of    -> adam
    // which forms a cycle in the directed graph the layout traverses.
    const layout = new TreeLayout();
    const nodeIds = ['a', 'b', 'c'];
    const edges = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'b', targetId: 'a' },
      { sourceId: 'b', targetId: 'c' },
      { sourceId: 'c', targetId: 'b' },
    ];

    expect(() => layout.compute(nodeIds, edges)).not.toThrow();
    const positions = layout.compute(nodeIds, edges);
    expect(positions.size).toBeGreaterThan(0);
  });

  it('should not blow the stack on a self-loop', () => {
    const layout = new TreeLayout();
    expect(() =>
      layout.compute(['x'], [{ sourceId: 'x', targetId: 'x' }]),
    ).not.toThrow();
  });
});
