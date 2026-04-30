import { describe, it, expect } from 'vitest';
import { EdgeMesh } from '../../src/renderer/EdgeMesh.js';

interface EndpointPair {
  sourceId: string;
  targetId: string;
}

function build(edgeIds: string[], endpoints: EndpointPair[]): EdgeMesh {
  const mesh = new EdgeMesh();
  mesh.createLineSegments(edgeIds.length);
  mesh.setEdgeIds(edgeIds);
  mesh.setEdgeEndpoints(endpoints);
  return mesh;
}

function readAlpha(mesh: EdgeMesh, segmentIndex: number): number {
  const geom = (mesh as unknown as { geometry: import('three').BufferGeometry })
    .geometry;
  const colorAttr = geom.getAttribute('color');
  const arr = colorAttr.array as Float32Array;
  return arr[segmentIndex * 8 + 3];
}

describe('EdgeMesh.setHighlight', () => {
  it('keeps every edge at full alpha when highlight is empty', () => {
    const mesh = build(
      ['e1', 'e2'],
      [
        { sourceId: 'a', targetId: 'b' },
        { sourceId: 'b', targetId: 'c' },
      ],
    );
    mesh.setHighlight(new Set());
    expect(readAlpha(mesh, 0)).toBe(1);
    expect(readAlpha(mesh, 1)).toBe(1);
  });

  it('dims edges when only one endpoint is highlighted', () => {
    const mesh = build(
      ['e1', 'e2'],
      [
        { sourceId: 'a', targetId: 'b' },
        { sourceId: 'b', targetId: 'c' },
      ],
    );
    mesh.setHighlight(new Set(['a']));
    expect(readAlpha(mesh, 0)).toBeCloseTo(0.15);
    expect(readAlpha(mesh, 1)).toBeCloseTo(0.15);
  });

  it('keeps edges at full alpha when both endpoints are highlighted', () => {
    const mesh = build(
      ['e1', 'e2'],
      [
        { sourceId: 'a', targetId: 'b' },
        { sourceId: 'b', targetId: 'c' },
      ],
    );
    mesh.setHighlight(new Set(['a', 'b']));
    expect(readAlpha(mesh, 0)).toBe(1);
    expect(readAlpha(mesh, 1)).toBeCloseTo(0.15);
  });

  it('visibility hidden edges stay at alpha 0', () => {
    const mesh = build(
      ['e1', 'e2'],
      [
        { sourceId: 'a', targetId: 'b' },
        { sourceId: 'b', targetId: 'c' },
      ],
    );
    mesh.setVisibility(new Set(['e2']));
    mesh.setHighlight(new Set(['a', 'b', 'c']));
    expect(readAlpha(mesh, 0)).toBe(0);
    expect(readAlpha(mesh, 1)).toBe(1);
  });

  it('restores baseline when highlight is cleared', () => {
    const mesh = build(
      ['e1'],
      [{ sourceId: 'a', targetId: 'b' }],
    );
    mesh.setHighlight(new Set(['a']));
    mesh.setHighlight(new Set());
    expect(readAlpha(mesh, 0)).toBe(1);
  });

  it('is a no-op when no endpoints are registered', () => {
    const mesh = new EdgeMesh();
    mesh.createLineSegments(1);
    mesh.setEdgeIds(['e1']);
    // No setEdgeEndpoints call.
    expect(() => mesh.setHighlight(new Set(['a']))).not.toThrow();
    expect(readAlpha(mesh, 0)).toBe(1);
  });
});
