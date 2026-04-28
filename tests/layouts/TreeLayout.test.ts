import { describe, it, expect } from 'vitest';
import { TreeLayout } from '../../src/layouts/TreeLayout.js';
import { buildTreeEdgeSegments } from '../../src/renderer/TreeEdgeMesh.js';
import { TreeNodeMesh } from '../../src/renderer/TreeNodeMesh.js';

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

  it('parental drop line extends from the marriage-line Y to the sibling-bar Y with no gap', () => {
    // Adam + Eve as a couple, Cain / Abel / Seth as their children. The
    // marriage line is drawn at Adam's centre-y (= Eve's centre-y); the
    // parent → children drop must start at the *same* y so the marriage
    // line and the drop visually connect. Prior to this fix the drop
    // started at the parents' card-bottom (`pa.y - halfH`), leaving a
    // halfH-sized gap between the marriage line and the top of the drop.
    const layout = new TreeLayout();
    const positions = layout.compute(
      ['adam', 'eve', 'cain', 'abel', 'seth'],
      [
        { sourceId: 'adam', targetId: 'eve', type: 'husband_of' },
        { sourceId: 'eve', targetId: 'adam', type: 'wife_of' },
        { sourceId: 'adam', targetId: 'cain', type: 'father_of' },
        { sourceId: 'eve', targetId: 'cain', type: 'mother_of' },
        { sourceId: 'adam', targetId: 'abel', type: 'father_of' },
        { sourceId: 'eve', targetId: 'abel', type: 'mother_of' },
        { sourceId: 'adam', targetId: 'seth', type: 'father_of' },
        { sourceId: 'eve', targetId: 'seth', type: 'mother_of' },
      ],
    );

    const cardSize = {
      width: TreeNodeMesh.DEFAULT_WIDTH,
      height: TreeNodeMesh.DEFAULT_HEIGHT,
    };
    const segments = buildTreeEdgeSegments(
      positions,
      [
        { sourceId: 'adam', targetId: 'eve', type: 'husband_of' },
        { sourceId: 'eve', targetId: 'adam', type: 'wife_of' },
        { sourceId: 'adam', targetId: 'cain', type: 'father_of' },
        { sourceId: 'eve', targetId: 'cain', type: 'mother_of' },
        { sourceId: 'adam', targetId: 'abel', type: 'father_of' },
        { sourceId: 'eve', targetId: 'abel', type: 'mother_of' },
        { sourceId: 'adam', targetId: 'seth', type: 'father_of' },
        { sourceId: 'eve', targetId: 'seth', type: 'mother_of' },
      ],
      cardSize,
    );

    const adam = positions.get('adam')!;
    const eve = positions.get('eve')!;
    const cain = positions.get('cain')!;
    expect(adam.y).toBe(eve.y);
    const marriageY = adam.y;
    const halfH = cardSize.height / 2;

    // Find the marriage line segment (horizontal, between adam & eve at y=marriageY).
    const marriageSeg = segments.find(
      (s) =>
        Math.abs(s.a.y - marriageY) < 1e-6 &&
        Math.abs(s.b.y - marriageY) < 1e-6 &&
        Math.abs(s.a.x - s.b.x) > 1, // horizontal
    );
    expect(marriageSeg).toBeDefined();
    // Marriage line endpoints share the same y as each other.
    expect(marriageSeg!.a.y).toBeCloseTo(marriageSeg!.b.y, 6);
    expect(marriageSeg!.a.y).toBeCloseTo(marriageY, 6);

    // Identify the parent → bar vertical drop. It is the one vertical
    // segment whose top y is at-or-near the marriage row and whose
    // bottom y is the sibling-bar y (between the parents and children).
    const childTopY = cain.y + halfH;
    const parentBottomY = marriageY - halfH;
    const expectedBarY = (parentBottomY + childTopY) / 2;

    const verticalDrops = segments.filter(
      (s) => Math.abs(s.a.x - s.b.x) < 1e-6 && Math.abs(s.a.y - s.b.y) > 1,
    );
    // The parental drop is the one whose bottom Y matches the bar Y and
    // whose top Y is at or above the marriage line.
    const parentalDrop = verticalDrops.find(
      (s) => Math.abs(Math.min(s.a.y, s.b.y) - expectedBarY) < 1e-6 &&
             Math.max(s.a.y, s.b.y) >= marriageY - 1e-6,
    );
    expect(parentalDrop).toBeDefined();

    const dropTopY = Math.max(parentalDrop!.a.y, parentalDrop!.b.y);
    const dropBottomY = Math.min(parentalDrop!.a.y, parentalDrop!.b.y);

    // The drop's TOP must reach the marriage-line Y exactly — no gap.
    expect(dropTopY).toBeCloseTo(marriageY, 6);
    // ...and bottom must reach the sibling-bar Y.
    expect(dropBottomY).toBeCloseTo(expectedBarY, 6);
    // Marriage line and drop top share the same y (the visual join).
    expect(dropTopY).toBeCloseTo(marriageSeg!.a.y, 6);
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
