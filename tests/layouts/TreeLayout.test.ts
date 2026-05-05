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
        { sourceId: 'root', targetId: 'child1', type: 'parent_of' },
        { sourceId: 'root', targetId: 'child2', type: 'parent_of' },
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
    // Hosts can emit reciprocal edges (X parent_of Y AND Y parent_of X)
    // which forms a cycle in the directed graph the layout traverses.
    // The visited-set guard absorbs it.
    const layout = new TreeLayout();
    const nodeIds = ['a', 'b', 'c'];
    const edges = [
      { sourceId: 'a', targetId: 'b', type: 'parent_of' },
      { sourceId: 'b', targetId: 'a', type: 'parent_of' },
      { sourceId: 'b', targetId: 'c', type: 'parent_of' },
      { sourceId: 'c', targetId: 'b', type: 'parent_of' },
    ];

    expect(() => layout.compute(nodeIds, edges)).not.toThrow();
    const positions = layout.compute(nodeIds, edges);
    expect(positions.size).toBeGreaterThan(0);
  });

  it('should not blow the stack on a self-loop', () => {
    const layout = new TreeLayout();
    expect(() =>
      layout.compute(['x'], [{ sourceId: 'x', targetId: 'x', type: 'parent_of' }]),
    ).not.toThrow();
  });

  it('pairs same-depth peers and centers them over their shared child', () => {
    const layout = new TreeLayout({
      parentEdgeTypes: ['parent_of'],
      pairedEdgeTypes: ['paired_with'],
    });
    const positions = layout.compute(
      ['p1', 'p2', 'kid'],
      [
        { sourceId: 'p1', targetId: 'p2', type: 'paired_with' },
        { sourceId: 'p2', targetId: 'p1', type: 'paired_with' },
        { sourceId: 'p1', targetId: 'kid', type: 'parent_of' },
        { sourceId: 'p2', targetId: 'kid', type: 'parent_of' },
      ],
    );

    const p1 = positions.get('p1')!;
    const p2 = positions.get('p2')!;
    const kid = positions.get('kid')!;
    // Pair share a row.
    expect(p1.y).toBe(p2.y);
    // Pair are horizontally separated.
    expect(Math.abs(p1.x - p2.x)).toBeGreaterThan(0);
    // Child is below the parents.
    expect(kid.y).toBeLessThan(p1.y);
    // Child sits at the midpoint of the parent pair.
    expect(kid.x).toBeCloseTo((p1.x + p2.x) / 2, 5);
    // 2D plane.
    expect(p1.z).toBe(0);
    expect(p2.z).toBe(0);
    expect(kid.z).toBe(0);
  });

  it('produces deterministic positions for the same input', () => {
    const layout = new TreeLayout({ pairedEdgeTypes: ['paired_with'] });
    const data = {
      ids: ['a', 'b', 'c', 'd'],
      edges: [
        { sourceId: 'a', targetId: 'b', type: 'paired_with' },
        { sourceId: 'a', targetId: 'c', type: 'parent_of' },
        { sourceId: 'a', targetId: 'd', type: 'parent_of' },
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
        { sourceId: 'p', targetId: 'c1', type: 'parent_of' },
        { sourceId: 'p', targetId: 'c2', type: 'parent_of' },
        { sourceId: 'p', targetId: 'c3', type: 'parent_of' },
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

  it('parental drop line extends from the pair-line Y to the sibling-bar Y with no gap', () => {
    // A paired pair (p1 + p2) at the top; three shared children
    // beneath. The horizontal pair-line is drawn at p1's center-y (=
    // p2's center-y); the parent -> children drop must start at the
    // *same* y so the pair-line and the drop visually connect. Prior to
    // this fix the drop started at the parents' card-bottom
    // (`pa.y - halfH`), leaving a halfH-sized gap between the pair-line
    // and the top of the drop.
    const layout = new TreeLayout({
      parentEdgeTypes: ['father_of', 'mother_of', 'parent_of'],
      pairedEdgeTypes: ['husband_of', 'wife_of', 'married_to', 'spouse_of'],
    });
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

  it('ignores edges whose type is neither a parent nor a paired type', () => {
    // `lived_in` is neither a configured parent type nor a paired type,
    // so it should not contribute to hierarchy.
    const layout = new TreeLayout();
    const positions = layout.compute(
      ['a', 'b'],
      [{ sourceId: 'a', targetId: 'b', type: 'lived_in' }],
    );
    // Both nodes still get a position (they fall into the disconnected-mop-up
    // pass), but they sit on the same row because no parent edge ties
    // them.
    expect(positions.size).toBe(2);
    expect(positions.get('a')!.y).toBe(positions.get('b')!.y);
  });

  // ---- Domain-agnostic edge type configuration -----------------------------
  // Tree view is generic: org charts, supply chains, taxonomies, citation
  // graphs, family trees, etc. The layout consults configurable
  // `parentEdgeTypes` / `pairedEdgeTypes` to decide which edges form
  // hierarchy and which form same-depth pairs; nothing is hard-coded to a
  // particular domain.

  it('treats only parentEdgeTypes as parent->child (default ["parent_of"])', () => {
    // Two disjoint parent->child relations: one labeled `parent_of` (the
    // generic CS-textbook term, the new default) and one labeled
    // `father_of` (a domain-specific kinship term that is NOT in the
    // default set). The layout should treat the first as hierarchy and
    // ignore the second; the second pair therefore lays out as two
    // disconnected single-node trees on the same row.
    const layout = new TreeLayout();
    const positions = layout.compute(
      ['gp', 'gc', 'fp', 'fc'],
      [
        { sourceId: 'gp', targetId: 'gc', type: 'parent_of' },
        { sourceId: 'fp', targetId: 'fc', type: 'father_of' },
      ],
    );

    const gp = positions.get('gp')!;
    const gc = positions.get('gc')!;
    const fp = positions.get('fp')!;
    const fc = positions.get('fc')!;

    // `parent_of` forms a 2-level tree.
    expect(gp.y).toBeGreaterThan(gc.y);
    // `father_of` is ignored: both nodes are roots, share the same row.
    expect(fp.y).toBe(fc.y);
    // ...and that row is the same as `gp` (the other root).
    expect(fp.y).toBe(gp.y);
  });

  it('uses configured parentEdgeTypes when provided (org chart)', () => {
    // Org chart: edges are `manages`. With the new option the layout
    // recognizes them as parent->child.
    const layout = new TreeLayout({ parentEdgeTypes: ['manages'] });
    const positions = layout.compute(
      ['director', 'engineer1', 'engineer2'],
      [
        { sourceId: 'director', targetId: 'engineer1', type: 'manages' },
        { sourceId: 'director', targetId: 'engineer2', type: 'manages' },
      ],
    );

    const dir = positions.get('director')!;
    const e1 = positions.get('engineer1')!;
    const e2 = positions.get('engineer2')!;

    // Director sits above the engineers.
    expect(dir.y).toBeGreaterThan(e1.y);
    expect(dir.y).toBeGreaterThan(e2.y);
    // Engineers are siblings on the same row, separated horizontally.
    expect(e1.y).toBe(e2.y);
    expect(e1.x).not.toBe(e2.x);
  });

  it('pairedEdgeTypes opts in to same-depth pairing (default empty)', () => {
    // Two roots linked by `married_to`, each with their own kid. Under
    // default options the paired list is empty and the two roots are
    // independent forest entries; the kid of `x` sits centered under
    // `x`, not under the `x`/`y` midpoint.
    const noPair = new TreeLayout();
    const noPairPositions = noPair.compute(
      ['x', 'y', 'kid'],
      [
        { sourceId: 'x', targetId: 'y', type: 'married_to' },
        { sourceId: 'x', targetId: 'kid', type: 'parent_of' },
      ],
    );
    const xNo = noPairPositions.get('x')!;
    const yNo = noPairPositions.get('y')!;
    const kidNo = noPairPositions.get('kid')!;
    // No pairing — kid is centered under `x` alone, not the x/y midpoint.
    expect(kidNo.x).toBeCloseTo(xNo.x, 5);
    // Without pairing, `y` is laid out as a separate forest entry off to
    // the side; its center does not coincide with the kid's column.
    expect(Math.abs(yNo.x - kidNo.x)).toBeGreaterThan(1);

    // Now opt in: the same `married_to` link pairs `x` and `y` at the
    // shared depth so the kid sits centered between the pair.
    const paired = new TreeLayout({ pairedEdgeTypes: ['married_to'] });
    const pairedPositions = paired.compute(
      ['x', 'y', 'kid'],
      [
        { sourceId: 'x', targetId: 'y', type: 'married_to' },
        { sourceId: 'x', targetId: 'kid', type: 'parent_of' },
      ],
    );
    const x = pairedPositions.get('x')!;
    const y = pairedPositions.get('y')!;
    const kid = pairedPositions.get('kid')!;
    // Pair share a row.
    expect(x.y).toBe(y.y);
    // Kid sits centered between the pair, not under either alone.
    expect(kid.x).toBeCloseTo((x.x + y.x) / 2, 5);
    expect(kid.x).not.toBeCloseTo(x.x, 5);
    expect(kid.x).not.toBeCloseTo(y.x, 5);
  });

  it('still protects against cycles + lays out a forest after the rename (regression)', () => {
    // Reproduces the existing cycle + forest behavior using the new
    // generic `parent_of` edge type, to confirm the algorithmic
    // behavior is unchanged after the family-bias is removed.
    const layout = new TreeLayout();
    const nodeIds = ['a', 'b', 'c', 'lone'];
    const edges = [
      { sourceId: 'a', targetId: 'b', type: 'parent_of' },
      { sourceId: 'b', targetId: 'a', type: 'parent_of' }, // cycle
      { sourceId: 'b', targetId: 'c', type: 'parent_of' },
      // `lone` has no edges -> separate forest entry.
    ];
    expect(() => layout.compute(nodeIds, edges)).not.toThrow();
    const positions = layout.compute(nodeIds, edges);
    expect(positions.size).toBe(4);
    // `lone` is a separate forest entry: it shares the top row with `a`.
    expect(positions.get('lone')!.y).toBe(positions.get('a')!.y);
  });
});
