import { describe, it, expect } from 'vitest';
import {
  TreeEdgeMesh,
  type TreeEdgeSegment,
} from '../../src/renderer/TreeEdgeMesh.js';

function makeSegment(
  source: string,
  target: string,
): TreeEdgeSegment {
  return {
    a: { x: 0, y: 0, z: 0 },
    b: { x: 1, y: 0, z: 0 },
    color: '#fff',
    sourceNodeId: source,
    targetNodeId: target,
  };
}

function readAlpha(mesh: TreeEdgeMesh, segmentIndex: number): number {
  const internal = mesh as unknown as {
    geometry: import('three').BufferGeometry | null;
  };
  const geom = internal.geometry!;
  const colorAttr = geom.getAttribute('color');
  const arr = colorAttr.array as Float32Array;
  return arr[segmentIndex * 8 + 3];
}

describe('TreeEdgeMesh.setHighlight', () => {
  it('keeps every segment at full alpha when highlight is empty', () => {
    const mesh = new TreeEdgeMesh();
    mesh.build([makeSegment('a', 'b'), makeSegment('b', 'c')]);
    mesh.setHighlight(new Set());
    expect(readAlpha(mesh, 0)).toBe(1);
    expect(readAlpha(mesh, 1)).toBe(1);
  });

  it('dims segments where one endpoint is unhighlighted', () => {
    const mesh = new TreeEdgeMesh();
    mesh.build([makeSegment('a', 'b'), makeSegment('b', 'c')]);
    mesh.setHighlight(new Set(['a']));
    expect(readAlpha(mesh, 0)).toBeCloseTo(0.15);
    expect(readAlpha(mesh, 1)).toBeCloseTo(0.15);
  });

  it('keeps segments at full alpha when both endpoints are highlighted', () => {
    const mesh = new TreeEdgeMesh();
    mesh.build([makeSegment('a', 'b')]);
    mesh.setHighlight(new Set(['a', 'b']));
    expect(readAlpha(mesh, 0)).toBe(1);
  });

  it('visibility wins over highlight', () => {
    const mesh = new TreeEdgeMesh();
    mesh.build([makeSegment('a', 'b')]);
    mesh.setVisibility(new Set()); // hide all
    mesh.setHighlight(new Set(['a', 'b']));
    expect(readAlpha(mesh, 0)).toBe(0);
  });
});
