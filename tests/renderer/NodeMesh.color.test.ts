import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { NodeMesh } from '../../src/renderer/NodeMesh.js';

/**
 * Regression: Three.js InstancedMesh.setColorAt multiplies the per-instance
 * color by the material's base color. If the material's base color is anything
 * other than white, every resolved instance color gets tinted by it. To make
 * the consumer-facing nodeColors override and the auto-palette render
 * faithfully, the base material color MUST be white (0xffffff) for the styles
 * that rely on per-instance colors (sphere/dot and card).
 */
describe('NodeMesh material base color', () => {
  it('uses white base for sphere style so instance colors render directly', () => {
    const mesh = new NodeMesh();
    mesh.createInstancedMesh(1);
    const instanced = mesh.getMesh()!;
    const material = instanced.material as THREE.MeshPhongMaterial;
    expect(material.color.getHex()).toBe(0xffffff);
  });

  it('uses white base for card style so instance colors render directly', () => {
    const mesh = new NodeMesh({ style: 'card' });
    mesh.createInstancedMesh(1);
    const instanced = mesh.getMesh()!;
    const material = instanced.material as THREE.MeshPhongMaterial;
    expect(material.color.getHex()).toBe(0xffffff);
  });
});
