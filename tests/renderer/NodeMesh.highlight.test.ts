import { describe, it, expect } from 'vitest';
import { NodeMesh } from '../../src/renderer/NodeMesh.js';

describe('NodeMesh.setHighlight', () => {
  function build(ids: string[]): NodeMesh {
    const mesh = new NodeMesh();
    mesh.createInstancedMesh(ids.length);
    mesh.setNodeIds(ids);
    return mesh;
  }

  it('keeps every instance at full alpha when highlight set is empty', () => {
    const mesh = build(['a', 'b', 'c']);
    mesh.setHighlight(new Set());
    const arr = mesh.getInstanceAlpha()!.array as Float32Array;
    expect(Array.from(arr)).toEqual([1, 1, 1]);
  });

  it('dims non-highlighted instances when highlight set is non-empty', () => {
    const mesh = build(['a', 'b', 'c']);
    mesh.setHighlight(new Set(['b']));
    const arr = mesh.getInstanceAlpha()!.array as Float32Array;
    expect(arr[0]).toBeCloseTo(0.3);
    expect(arr[1]).toBe(1);
    expect(arr[2]).toBeCloseTo(0.3);
  });

  it('restores baseline when set back to empty', () => {
    const mesh = build(['a', 'b']);
    mesh.setHighlight(new Set(['a']));
    mesh.setHighlight(new Set());
    const arr = mesh.getInstanceAlpha()!.array as Float32Array;
    expect(Array.from(arr)).toEqual([1, 1]);
  });

  it('visibility wins over highlight (hidden instance stays at alpha 0)', () => {
    const mesh = build(['a', 'b', 'c']);
    mesh.setVisibility(new Set(['a', 'c']));
    mesh.setHighlight(new Set(['b']));
    const arr = mesh.getInstanceAlpha()!.array as Float32Array;
    // 'b' is hidden by visibility → alpha 0 even though it's "highlighted".
    expect(arr[1]).toBe(0);
    // 'a' and 'c' are visible but not highlighted → dimmed.
    expect(arr[0]).toBeCloseTo(0.3);
    expect(arr[2]).toBeCloseTo(0.3);
  });

  it('bumps the buffer version (needsUpdate)', () => {
    const mesh = build(['a']);
    const attr = mesh.getInstanceAlpha()!;
    // Three.js InstancedBufferAttribute exposes `needsUpdate` as a setter
    // that increments `version`. Read `version` directly to verify the
    // setHighlight call requested an upload.
    const before = attr.version;
    mesh.setHighlight(new Set(['a']));
    expect(attr.version).toBeGreaterThan(before);
  });

  it('is a no-op before createInstancedMesh runs', () => {
    const mesh = new NodeMesh();
    expect(() => mesh.setHighlight(new Set(['a']))).not.toThrow();
  });

  it('survives dispose + rebuild', () => {
    const mesh = build(['a', 'b']);
    mesh.setHighlight(new Set(['a']));
    mesh.dispose();
    mesh.createInstancedMesh(2);
    mesh.setNodeIds(['x', 'y']);
    const arr = mesh.getInstanceAlpha()!.array as Float32Array;
    // Highlight state was reset by dispose.
    expect(Array.from(arr)).toEqual([1, 1]);
  });
});
