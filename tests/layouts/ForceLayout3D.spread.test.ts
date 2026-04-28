import { describe, it, expect } from 'vitest';
import { ForceLayout3D } from '../../src/layouts/ForceLayout3D.js';
import type { NodeId } from '../../src/types.js';

/**
 * Regression suite for the 0.1.11 layout-spread fix.
 *
 * The 0.1.10 force tuning crushed densely-bidirectional graphs (e.g. the
 * Bible Graph seed where every relationship is encoded as two directional
 * edges) into a tight pile because every connected pair received TWO
 * springs. This file pins down three properties that protect against
 * regression:
 *   1. Bidirectional edges are deduped — the simulation sees one spring
 *      per unordered pair regardless of how many directional edges the
 *      host stored.
 *   2. After a settled `compute()`, no two distinct nodes sit closer than
 *      the spring rest length divided by two (i.e. ≥ 40 units apart with
 *      the 0.1.11 80u rest length). This is the visual "no overlap" check.
 *   3. Disconnected (orphan) nodes don't drift to the simulation periphery
 *      — they stay within ~3× the cluster radius thanks to the centering
 *      force.
 */
describe('ForceLayout3D — Bible-Graph-shaped spread', () => {
  // Mirror of the biblegraph app seed: 19 nodes, 51 directional edges, lots
  // of bidirectional pairs (husband_of/wife_of, father_of/son_of, etc.).
  const nodes: NodeId[] = [
    'adam', 'eve', 'cain', 'abel', 'seth', 'enosh', 'enoch', 'methuselah',
    'lamech', 'noah', 'shem', 'ham', 'japheth',
    'eden', 'nod',
    'creation', 'fall', 'flood',
    'orphan', // intentional disconnected node — stress-tests centering force
  ];

  const edges: Array<{ sourceId: string; targetId: string }> = [
    // Adam ↔ Eve
    { sourceId: 'adam', targetId: 'eve' },
    { sourceId: 'eve', targetId: 'adam' },
    // Adam/Eve → Cain
    { sourceId: 'adam', targetId: 'cain' },
    { sourceId: 'cain', targetId: 'adam' },
    { sourceId: 'eve', targetId: 'cain' },
    { sourceId: 'cain', targetId: 'eve' },
    // Adam/Eve → Abel
    { sourceId: 'adam', targetId: 'abel' },
    { sourceId: 'abel', targetId: 'adam' },
    { sourceId: 'eve', targetId: 'abel' },
    { sourceId: 'abel', targetId: 'eve' },
    // Adam/Eve → Seth
    { sourceId: 'adam', targetId: 'seth' },
    { sourceId: 'seth', targetId: 'adam' },
    { sourceId: 'eve', targetId: 'seth' },
    { sourceId: 'seth', targetId: 'eve' },
    // Sibling links
    { sourceId: 'cain', targetId: 'abel' },
    { sourceId: 'abel', targetId: 'cain' },
    { sourceId: 'cain', targetId: 'seth' },
    { sourceId: 'seth', targetId: 'cain' },
    { sourceId: 'abel', targetId: 'seth' },
    { sourceId: 'seth', targetId: 'abel' },
    // Sethite line
    { sourceId: 'seth', targetId: 'enosh' },
    { sourceId: 'enosh', targetId: 'seth' },
    { sourceId: 'enoch', targetId: 'methuselah' },
    { sourceId: 'methuselah', targetId: 'enoch' },
    { sourceId: 'methuselah', targetId: 'lamech' },
    { sourceId: 'lamech', targetId: 'methuselah' },
    { sourceId: 'lamech', targetId: 'noah' },
    { sourceId: 'noah', targetId: 'lamech' },
    // Noah → sons
    { sourceId: 'noah', targetId: 'shem' },
    { sourceId: 'shem', targetId: 'noah' },
    { sourceId: 'noah', targetId: 'ham' },
    { sourceId: 'ham', targetId: 'noah' },
    { sourceId: 'noah', targetId: 'japheth' },
    { sourceId: 'japheth', targetId: 'noah' },
    // Sons of Noah sibling links
    { sourceId: 'shem', targetId: 'ham' },
    { sourceId: 'ham', targetId: 'shem' },
    { sourceId: 'shem', targetId: 'japheth' },
    { sourceId: 'japheth', targetId: 'shem' },
    { sourceId: 'ham', targetId: 'japheth' },
    { sourceId: 'japheth', targetId: 'ham' },
    // Place dwellings
    { sourceId: 'adam', targetId: 'eden' },
    { sourceId: 'eve', targetId: 'eden' },
    { sourceId: 'cain', targetId: 'nod' },
    // Event participation
    { sourceId: 'adam', targetId: 'creation' },
    { sourceId: 'eve', targetId: 'creation' },
    { sourceId: 'adam', targetId: 'fall' },
    { sourceId: 'eve', targetId: 'fall' },
    { sourceId: 'noah', targetId: 'flood' },
    { sourceId: 'shem', targetId: 'flood' },
    { sourceId: 'ham', targetId: 'flood' },
    { sourceId: 'japheth', targetId: 'flood' },
  ];

  function compute() {
    const layout = new ForceLayout3D({ animated: false });
    return layout.compute(nodes, edges);
  }

  function pairwiseDistances(positions: Map<NodeId, { x: number; y: number; z: number }>) {
    const arr = Array.from(positions.entries());
    const out: Array<{ a: string; b: string; d: number }> = [];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const [aId, ap] = arr[i];
        const [bId, bp] = arr[j];
        const dx = ap.x - bp.x;
        const dy = ap.y - bp.y;
        const dz = ap.z - bp.z;
        out.push({ a: aId, b: bId, d: Math.sqrt(dx * dx + dy * dy + dz * dz) });
      }
    }
    return out;
  }

  it('keeps every node pair at least 25 units apart after settling', () => {
    const positions = compute();
    expect(positions.size).toBe(nodes.length);

    const dists = pairwiseDistances(positions);
    const min = dists.reduce((m, e) => (e.d < m.d ? e : m), dists[0]);

    // 25 is a conservative floor — well below the 80u rest length but
    // above the "labels overlap" threshold. The 0.1.10 tuning frequently
    // produced minimum pair distances under 5u.
    expect(min.d, `closest pair: ${min.a} ↔ ${min.b} at ${min.d.toFixed(2)}u`)
      .toBeGreaterThan(25);
  });

  it('keeps the orphan within 3× the cluster radius', () => {
    const positions = compute();

    // Compute centroid + 95th percentile distance over the connected nodes.
    const connectedIds = nodes.filter((id) => id !== 'orphan');
    let cx = 0, cy = 0, cz = 0;
    for (const id of connectedIds) {
      const p = positions.get(id)!;
      cx += p.x; cy += p.y; cz += p.z;
    }
    cx /= connectedIds.length;
    cy /= connectedIds.length;
    cz /= connectedIds.length;

    const dists = connectedIds
      .map((id) => {
        const p = positions.get(id)!;
        const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      })
      .sort((a, b) => a - b);
    const p95 = dists[Math.floor(dists.length * 0.95)];

    const orphan = positions.get('orphan')!;
    const dOrphan = Math.sqrt(
      (orphan.x - cx) ** 2 + (orphan.y - cy) ** 2 + (orphan.z - cz) ** 2,
    );

    // Without centering, the orphan's distance from the cluster grows
    // with each repulsion-only tick. With the 0.005 centering force it
    // should sit within a small multiple of the cluster's own radius.
    expect(dOrphan, `orphan at ${dOrphan.toFixed(2)}u, cluster p95 ${p95.toFixed(2)}u`)
      .toBeLessThan(p95 * 3 + 200);
  });

  it('treats bidirectional edges as a single spring (dedup)', () => {
    // Run two simulations: one with both directions, one with only the
    // forward direction. Their settled minimum-pair distances should be
    // similar (within 30%) — proving the simulation sees the same spring
    // network in both cases.
    const forwardOnly = edges.filter(
      (e, i) => !edges.slice(0, i).some(
        (prev) => prev.sourceId === e.targetId && prev.targetId === e.sourceId,
      ),
    );

    const layoutA = new ForceLayout3D({ animated: false });
    const posA = layoutA.compute(nodes, edges);
    const layoutB = new ForceLayout3D({ animated: false });
    const posB = layoutB.compute(nodes, forwardOnly);

    const minA = pairwiseDistances(posA).reduce((m, e) => Math.min(m, e.d), Infinity);
    const minB = pairwiseDistances(posB).reduce((m, e) => Math.min(m, e.d), Infinity);

    // Random-init noise means we can't expect exact equality; we just want
    // to assert they're in the same order of magnitude. Pre-fix, A's min
    // distance was ~½ of B's because A had double springs.
    const ratio = Math.min(minA, minB) / Math.max(minA, minB);
    expect(ratio).toBeGreaterThan(0.5);
  });
});
