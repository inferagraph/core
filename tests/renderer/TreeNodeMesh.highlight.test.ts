import { describe, it, expect } from 'vitest';
import { TreeNodeMesh } from '../../src/renderer/TreeNodeMesh.js';

function build(ids: string[]): TreeNodeMesh {
  const mesh = new TreeNodeMesh();
  mesh.build(
    ids.map((id) => ({
      id,
      position: { x: 0, y: 0, z: 0 },
      color: '#fff',
    })),
  );
  return mesh;
}

interface CardEntry {
  group: { visible: boolean };
  fillMaterial: { opacity: number };
  outlineMaterial: { opacity: number };
}

function getCard(mesh: TreeNodeMesh, id: string): CardEntry {
  const internal = mesh as unknown as { cards: Map<string, CardEntry> };
  return internal.cards.get(id)!;
}

describe('TreeNodeMesh.setHighlight', () => {
  it('keeps default opacity when highlight is empty', () => {
    const mesh = build(['a', 'b']);
    mesh.setHighlight(new Set());
    const a = getCard(mesh, 'a');
    expect(a.outlineMaterial.opacity).toBe(1);
    expect(a.fillMaterial.opacity).toBe(TreeNodeMesh.DEFAULT_FILL_OPACITY);
  });

  it('dims non-highlighted cards', () => {
    const mesh = build(['a', 'b', 'c']);
    mesh.setHighlight(new Set(['b']));
    const a = getCard(mesh, 'a');
    const b = getCard(mesh, 'b');
    const c = getCard(mesh, 'c');
    expect(b.outlineMaterial.opacity).toBe(1);
    expect(a.outlineMaterial.opacity).toBeCloseTo(0.3);
    expect(c.outlineMaterial.opacity).toBeCloseTo(0.3);
    expect(a.fillMaterial.opacity).toBeCloseTo(
      TreeNodeMesh.DEFAULT_FILL_OPACITY * 0.3,
    );
  });

  it('restores baseline when set to empty', () => {
    const mesh = build(['a', 'b']);
    mesh.setHighlight(new Set(['a']));
    mesh.setHighlight(new Set());
    const a = getCard(mesh, 'a');
    const b = getCard(mesh, 'b');
    expect(a.outlineMaterial.opacity).toBe(1);
    expect(b.outlineMaterial.opacity).toBe(1);
  });

  it('does not restore visibility on hidden cards', () => {
    const mesh = build(['a', 'b']);
    mesh.setVisibility(new Set(['a']));
    mesh.setHighlight(new Set(['b']));
    expect(getCard(mesh, 'a').group.visible).toBe(true);
    expect(getCard(mesh, 'b').group.visible).toBe(false);
  });

  it('visibility re-applies highlight after toggling', () => {
    const mesh = build(['a', 'b', 'c']);
    mesh.setHighlight(new Set(['a']));
    mesh.setVisibility(new Set(['a', 'b', 'c']));
    expect(getCard(mesh, 'b').outlineMaterial.opacity).toBeCloseTo(0.3);
  });
});
