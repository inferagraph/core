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
        { sourceId: 'root', targetId: 'child1', type: 'father_of' },
        { sourceId: 'root', targetId: 'child2', type: 'father_of' },
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
      { sourceId: 'a', targetId: 'b', type: 'father_of' },
      { sourceId: 'b', targetId: 'a', type: 'son_of' },
      { sourceId: 'b', targetId: 'c', type: 'father_of' },
      { sourceId: 'c', targetId: 'b', type: 'son_of' },
    ];

    expect(() => layout.compute(nodeIds, edges)).not.toThrow();
    const positions = layout.compute(nodeIds, edges);
    expect(positions.size).toBeGreaterThan(0);
  });

  it('should not blow the stack on a self-loop', () => {
    const layout = new TreeLayout();
    expect(() =>
      layout.compute(['x'], [{ sourceId: 'x', targetId: 'x', type: 'father_of' }]),
    ).not.toThrow();
  });

  it('pairs spouses at the same y and centres them over their child', () => {
    const layout = new TreeLayout();
    const positions = layout.compute(
      ['abe', 'sarah', 'isaac'],
      [
        { sourceId: 'abe', targetId: 'sarah', type: 'husband_of' },
        { sourceId: 'sarah', targetId: 'abe', type: 'wife_of' },
        { sourceId: 'abe', targetId: 'isaac', type: 'father_of' },
        { sourceId: 'sarah', targetId: 'isaac', type: 'mother_of' },
      ],
    );

    const abe = positions.get('abe')!;
    const sarah = positions.get('sarah')!;
    const isaac = positions.get('isaac')!;
    // Spouses share a row.
    expect(abe.y).toBe(sarah.y);
    // Spouses are horizontally separated.
    expect(Math.abs(abe.x - sarah.x)).toBeGreaterThan(0);
    // Child is below the parents.
    expect(isaac.y).toBeLessThan(abe.y);
    // Child sits at the midpoint of the parent pair.
    expect(isaac.x).toBeCloseTo((abe.x + sarah.x) / 2, 5);
    // 2D plane.
    expect(abe.z).toBe(0);
    expect(sarah.z).toBe(0);
    expect(isaac.z).toBe(0);
  });

  it('produces deterministic positions for the same input', () => {
    const layout = new TreeLayout();
    const data = {
      ids: ['a', 'b', 'c', 'd'],
      edges: [
        { sourceId: 'a', targetId: 'b', type: 'husband_of' },
        { sourceId: 'a', targetId: 'c', type: 'father_of' },
        { sourceId: 'a', targetId: 'd', type: 'father_of' },
      ],
    };
    const first = new Map(layout.compute(data.ids, data.edges));
    const second = new Map(layout.compute(data.ids, data.edges));
    for (const id of data.ids) {
      expect(second.get(id)).toEqual(first.get(id));
    }
  });

  it('lays out siblings on the same row beneath their parent', () => {
    const layout = new TreeLayout();
    const positions = layout.compute(
      ['p', 'c1', 'c2', 'c3'],
      [
        { sourceId: 'p', targetId: 'c1', type: 'father_of' },
        { sourceId: 'p', targetId: 'c2', type: 'father_of' },
        { sourceId: 'p', targetId: 'c3', type: 'father_of' },
      ],
    );
    const c1 = positions.get('c1')!;
    const c2 = positions.get('c2')!;
    const c3 = positions.get('c3')!;
    expect(c1.y).toBe(c2.y);
    expect(c2.y).toBe(c3.y);
    expect(c1.x).toBeLessThan(c2.x);
    expect(c2.x).toBeLessThan(c3.x);
  });

  it('ignores edges whose type is not parent or spouse', () => {
    // `lived_in` should not contribute to hierarchy.
    const layout = new TreeLayout();
    const positions = layout.compute(
      ['abe', 'beersheba'],
      [{ sourceId: 'abe', targetId: 'beersheba', type: 'lived_in' }],
    );
    // Both nodes still get a position (they fall into the disconnected-mop-up
    // pass), but they sit on the same row because no parent edge ties
    // them.
    expect(positions.size).toBe(2);
    expect(positions.get('abe')!.y).toBe(positions.get('beersheba')!.y);
  });
});
