import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', () => {
  // Geometries used by NodeMesh — both Sphere and Shape variants need to
  // accept `setAttribute` calls now that NodeMesh attaches a per-instance
  // alpha buffer for visibility hiding.
  const makeGeometry = () => {
    const attributes: Record<string, unknown> = {};
    return {
      attributes,
      setAttribute: vi.fn().mockImplementation((name: string, attr: unknown) => {
        attributes[name] = attr;
      }),
      getAttribute: vi.fn().mockImplementation((name: string) => attributes[name]),
      dispose: vi.fn(),
    };
  };
  return {
    SphereGeometry: vi.fn().mockImplementation(() => makeGeometry()),
    ShapeGeometry: vi.fn().mockImplementation(() => makeGeometry()),
    Shape: vi.fn().mockImplementation(() => ({
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
    })),
    MeshPhongMaterial: vi.fn().mockImplementation((opts: Record<string, unknown> = {}) => ({
      dispose: vi.fn(),
      color: { set: vi.fn() },
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      depthWrite: opts.depthWrite ?? true,
      onBeforeCompile: undefined as ((shader: unknown) => void) | undefined,
    })),
    InstancedMesh: vi.fn().mockImplementation((_geo, _mat, count) => ({
      count,
      instanceMatrix: { needsUpdate: false },
      instanceColor: { needsUpdate: false },
      setMatrixAt: vi.fn(),
      setColorAt: vi.fn(),
      geometry: { dispose: vi.fn() },
      material: { dispose: vi.fn() },
    })),
    InstancedBufferAttribute: vi.fn().mockImplementation((arr: Float32Array, size: number) => ({
      array: arr,
      itemSize: size,
      needsUpdate: false,
    })),
    Matrix4: vi.fn().mockImplementation(() => ({
      compose: vi.fn().mockReturnThis(),
    })),
    Vector3: vi.fn().mockImplementation((x, y, z) => ({
      x: x ?? 0,
      y: y ?? 0,
      z: z ?? 0,
    })),
    Quaternion: vi.fn().mockImplementation(() => ({
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    })),
    Color: vi.fn().mockImplementation(() => ({ r: 0, g: 0, b: 0 })),
  };
});

import * as THREE from 'three';
import { NodeMesh } from '../../src/renderer/NodeMesh.js';

describe('NodeMesh', () => {
  let mesh: NodeMesh;

  beforeEach(() => {
    vi.clearAllMocks();
    mesh = new NodeMesh();
  });

  describe('constructor defaults', () => {
    it('should default to dot style when no config provided', () => {
      expect(mesh.nodeStyle).toBe('dot');
    });

    it('should default card width to 80', () => {
      expect(mesh.getCardWidth()).toBe(80);
    });

    it('should default card height to 36', () => {
      expect(mesh.getCardHeight()).toBe(36);
    });
  });

  describe('constructor with config', () => {
    it('should accept card style', () => {
      const cardMesh = new NodeMesh({ style: 'card' });
      expect(cardMesh.nodeStyle).toBe('card');
    });

    it('should accept dot style explicitly', () => {
      const dotMesh = new NodeMesh({ style: 'dot' });
      expect(dotMesh.nodeStyle).toBe('dot');
    });

    it('should accept custom card dimensions', () => {
      const cardMesh = new NodeMesh({ style: 'card', cardWidth: 120, cardHeight: 50 });
      expect(cardMesh.getCardWidth()).toBe(120);
      expect(cardMesh.getCardHeight()).toBe(50);
    });

    it('should use default dimensions when only style is specified', () => {
      const cardMesh = new NodeMesh({ style: 'card' });
      expect(cardMesh.getCardWidth()).toBe(80);
      expect(cardMesh.getCardHeight()).toBe(36);
    });
  });

  describe('data properties (backward compatibility)', () => {
    it('should set and get position', () => {
      mesh.setPosition({ x: 1, y: 2, z: 3 });
      expect(mesh.getPosition()).toEqual({ x: 1, y: 2, z: 3 });
    });

    it('should default position to origin', () => {
      expect(mesh.getPosition()).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('should set and get color', () => {
      mesh.setColor('#ff0000');
      expect(mesh.getColor()).toBe('#ff0000');
    });

    it('should default color to #4a9eff', () => {
      expect(mesh.getColor()).toBe('#4a9eff');
    });

    it('should set and get radius', () => {
      mesh.setRadius(10);
      expect(mesh.getRadius()).toBe(10);
    });

    it('should default radius to 5', () => {
      expect(mesh.getRadius()).toBe(5);
    });
  });

  describe('Three.js integration — dot style', () => {
    it('should return null mesh before creation', () => {
      expect(mesh.getMesh()).toBeNull();
    });

    it('should create instanced mesh with correct count', () => {
      mesh.createInstancedMesh(100);
      const instancedMesh = mesh.getMesh();
      expect(instancedMesh).not.toBeNull();
      expect(instancedMesh!.count).toBe(100);
    });

    it('should use SphereGeometry for dot style', () => {
      mesh.createInstancedMesh(10);
      expect(THREE.SphereGeometry).toHaveBeenCalledWith(1, 24, 24);
    });

    it('should update instance position via setMatrixAt', () => {
      mesh.createInstancedMesh(10);
      mesh.updateInstance(0, { x: 5, y: 10, z: 15 });
      const instancedMesh = mesh.getMesh();
      expect(instancedMesh!.setMatrixAt).toHaveBeenCalledWith(0, expect.anything());
      expect(instancedMesh!.instanceMatrix.needsUpdate).toBe(true);
    });

    it('should update instance color via setColorAt', () => {
      mesh.createInstancedMesh(10);
      mesh.updateInstance(0, { x: 0, y: 0, z: 0 }, '#ff0000');
      const instancedMesh = mesh.getMesh();
      expect(instancedMesh!.setColorAt).toHaveBeenCalledWith(0, expect.anything());
    });

    it('should not throw when updating instance with no mesh', () => {
      expect(() => mesh.updateInstance(0, { x: 0, y: 0, z: 0 })).not.toThrow();
    });

    it('should dispose geometry and material', () => {
      mesh.createInstancedMesh(10);
      mesh.dispose();
      expect(mesh.getMesh()).toBeNull();
    });

    it('should dispose previous mesh when creating new one', () => {
      mesh.createInstancedMesh(5);
      const firstMesh = mesh.getMesh();
      expect(firstMesh).not.toBeNull();

      mesh.createInstancedMesh(10);
      const secondMesh = mesh.getMesh();
      expect(secondMesh).not.toBeNull();
      expect(secondMesh!.count).toBe(10);
    });

    it('should use custom scale when provided', () => {
      mesh.createInstancedMesh(10);
      mesh.updateInstance(0, { x: 1, y: 2, z: 3 }, undefined, 2.5);
      const instancedMesh = mesh.getMesh();
      expect(instancedMesh!.setMatrixAt).toHaveBeenCalled();
    });
  });

  describe('Three.js integration — card style', () => {
    let cardMesh: NodeMesh;

    beforeEach(() => {
      cardMesh = new NodeMesh({ style: 'card' });
    });

    it('should create instanced mesh with correct count', () => {
      cardMesh.createInstancedMesh(50);
      const instancedMesh = cardMesh.getMesh();
      expect(instancedMesh).not.toBeNull();
      expect(instancedMesh!.count).toBe(50);
    });

    it('should use ShapeGeometry for card style', () => {
      cardMesh.createInstancedMesh(10);
      expect(THREE.Shape).toHaveBeenCalled();
      expect(THREE.ShapeGeometry).toHaveBeenCalled();
    });

    it('should not use SphereGeometry for card style', () => {
      cardMesh.createInstancedMesh(10);
      expect(THREE.SphereGeometry).not.toHaveBeenCalled();
    });

    it('should create rounded rect shape with correct geometry calls', () => {
      cardMesh.createInstancedMesh(10);
      const shapeMock = (THREE.Shape as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(shapeMock.moveTo).toHaveBeenCalled();
      expect(shapeMock.lineTo).toHaveBeenCalled();
      expect(shapeMock.quadraticCurveTo).toHaveBeenCalled();
    });

    it('should update instance position via setMatrixAt', () => {
      cardMesh.createInstancedMesh(10);
      cardMesh.updateInstance(0, { x: 5, y: 10, z: 15 });
      const instancedMesh = cardMesh.getMesh();
      expect(instancedMesh!.setMatrixAt).toHaveBeenCalledWith(0, expect.anything());
      expect(instancedMesh!.instanceMatrix.needsUpdate).toBe(true);
    });

    it('should use uniform scale of 1 for card style when no scale provided', () => {
      cardMesh.createInstancedMesh(10);
      cardMesh.updateInstance(0, { x: 0, y: 0, z: 0 });
      // Verify Vector3 was called with (1, 1, 1) for scale
      const vector3Calls = (THREE.Vector3 as unknown as ReturnType<typeof vi.fn>).mock.calls;
      // The second Vector3 call in updateInstance is the scale vector (first is position)
      // Position call: (0, 0, 0), Scale call: (1, 1, 1)
      const scaleCalls = vector3Calls.filter(
        (call: number[]) => call[0] === 1 && call[1] === 1 && call[2] === 1,
      );
      expect(scaleCalls.length).toBeGreaterThan(0);
    });

    it('should use custom card dimensions', () => {
      const customMesh = new NodeMesh({ style: 'card', cardWidth: 100, cardHeight: 50 });
      customMesh.createInstancedMesh(10);
      expect(THREE.Shape).toHaveBeenCalled();
      expect(THREE.ShapeGeometry).toHaveBeenCalled();
    });

    it('should dispose correctly for card style', () => {
      cardMesh.createInstancedMesh(10);
      cardMesh.dispose();
      expect(cardMesh.getMesh()).toBeNull();
    });
  });

  describe('Three.js integration — custom style', () => {
    it('should create with custom style explicitly', () => {
      const customMesh = new NodeMesh({ style: 'custom' });
      expect(customMesh.nodeStyle).toBe('custom');
    });

    it('should auto-detect custom style when renderNode provided', () => {
      const renderNode = vi.fn();
      const customMesh = new NodeMesh({ renderNode });
      expect(customMesh.nodeStyle).toBe('custom');
    });

    it('should auto-detect custom style when component provided', () => {
      const component = () => null;
      const customMesh = new NodeMesh({ component });
      expect(customMesh.nodeStyle).toBe('custom');
    });

    it('should use SphereGeometry(1, 8, 8) for custom style hitbox', () => {
      const customMesh = new NodeMesh({ style: 'custom' });
      customMesh.createInstancedMesh(10);
      expect(THREE.SphereGeometry).toHaveBeenCalledWith(1, 8, 8);
    });

    it('should create transparent material with opacity 0', () => {
      const customMesh = new NodeMesh({ style: 'custom' });
      customMesh.createInstancedMesh(10);
      expect(THREE.MeshPhongMaterial).toHaveBeenCalledWith(
        expect.objectContaining({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
    });

    it('should scale by hitboxRadius in updateInstance', () => {
      const customMesh = new NodeMesh({ style: 'custom', hitboxRadius: 30 });
      customMesh.createInstancedMesh(10);
      customMesh.updateInstance(0, { x: 5, y: 10, z: 15 });

      // Verify Vector3 was called with hitboxRadius for scale
      const vector3Calls = (THREE.Vector3 as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const scaleCalls = vector3Calls.filter(
        (call: number[]) => call[0] === 30 && call[1] === 30 && call[2] === 30,
      );
      expect(scaleCalls.length).toBeGreaterThan(0);
    });
  });

  describe('VisibilityHost (per-instance alpha)', () => {
    it('createInstancedMesh seeds the instanceAlpha buffer with 1.0 per instance', () => {
      mesh.createInstancedMesh(4);
      const alpha = mesh.getInstanceAlpha();
      expect(alpha).not.toBeNull();
      expect(alpha!.array.length).toBe(4);
      for (let i = 0; i < 4; i++) {
        expect(alpha!.array[i]).toBeCloseTo(1, 5);
      }
    });

    it('default style material is transparent + depthWrite=false so alpha=0 hides cleanly', () => {
      mesh.createInstancedMesh(2);
      // The most recent MeshPhongMaterial constructor call should have
      // transparent:true and depthWrite:false in its options.
      const calls = (THREE.MeshPhongMaterial as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const last = calls[calls.length - 1][0];
      expect(last.transparent).toBe(true);
      expect(last.depthWrite).toBe(false);
    });

    it('setVisibility flips alpha 1↔0 per instance based on the predicate set', () => {
      mesh.createInstancedMesh(3);
      mesh.setNodeIds(['a', 'b', 'c']);
      mesh.setVisibility(new Set(['a', 'c']));
      const alpha = mesh.getInstanceAlpha()!;
      expect(alpha.array[0]).toBeCloseTo(1, 5); // a visible
      expect(alpha.array[1]).toBeCloseTo(0, 5); // b hidden
      expect(alpha.array[2]).toBeCloseTo(1, 5); // c visible
      expect(alpha.needsUpdate).toBe(true);
    });

    it('setVisibility is a no-op before createInstancedMesh', () => {
      expect(() => mesh.setVisibility(new Set(['a']))).not.toThrow();
    });

    it('setVisibility is a no-op when node ids have not been registered', () => {
      mesh.createInstancedMesh(2);
      mesh.setVisibility(new Set(['a']));
      const alpha = mesh.getInstanceAlpha()!;
      // No mapping → alpha stays at the initial 1.0.
      expect(alpha.array[0]).toBeCloseTo(1, 5);
      expect(alpha.array[1]).toBeCloseTo(1, 5);
    });
  });

  // Regression: 0.1.25 patched the wrong fragment chunk
  // (`<output_fragment>`) which Three.js r150+ renamed to
  // `<opaque_fragment>`. The String#replace silently no-op'd, the alpha
  // multiplication was never injected, and instances stayed opaque
  // regardless of the per-instance alpha buffer. The fix is to inject
  // against `<opaque_fragment>` in the fragment shader.
  describe('shader patch (instanceAlpha → fragment alpha)', () => {
    type ShaderLike = { vertexShader: string; fragmentShader: string };
    type MaterialLike = { onBeforeCompile?: (shader: ShaderLike) => void };

    it('installs an onBeforeCompile callback that injects the alpha multiplication', () => {
      mesh.createInstancedMesh(2);
      const calls = (THREE.MeshPhongMaterial as unknown as ReturnType<typeof vi.fn>).mock.results;
      const material = calls[calls.length - 1].value as MaterialLike;
      expect(typeof material.onBeforeCompile).toBe('function');

      const shader: ShaderLike = {
        vertexShader: 'void main() {\n#include <begin_vertex>\n}',
        fragmentShader: 'void main() {\n#include <opaque_fragment>\n}',
      };
      material.onBeforeCompile!(shader);

      // Vertex: declares attribute + varying, forwards instanceAlpha.
      expect(shader.vertexShader).toContain('attribute float instanceAlpha;');
      expect(shader.vertexShader).toContain('varying float vInstanceAlpha;');
      expect(shader.vertexShader).toContain('vInstanceAlpha = instanceAlpha;');

      // Fragment: declares the varying and multiplies into gl_FragColor.a.
      expect(shader.fragmentShader).toContain('varying float vInstanceAlpha;');
      expect(shader.fragmentShader).toContain('gl_FragColor.a *= vInstanceAlpha;');
    });

    it('targets <opaque_fragment> (the Three.js r150+ chunk name), not the legacy <output_fragment>', () => {
      mesh.createInstancedMesh(2);
      const calls = (THREE.MeshPhongMaterial as unknown as ReturnType<typeof vi.fn>).mock.results;
      const material = calls[calls.length - 1].value as MaterialLike;

      // Negative test: a shader with the OLD chunk name should NOT receive
      // the alpha-multiplication injection. (The varying declaration is
      // always prepended, so we only check for the multiplication line.)
      const legacyShader: ShaderLike = {
        vertexShader: 'void main() {\n#include <begin_vertex>\n}',
        fragmentShader: 'void main() {\n#include <output_fragment>\n}',
      };
      material.onBeforeCompile!(legacyShader);
      expect(legacyShader.fragmentShader).not.toContain('gl_FragColor.a *= vInstanceAlpha;');
    });
  });

  describe('getters', () => {
    it('should return stored renderNode function via getRenderNode', () => {
      const renderNode = vi.fn();
      const customMesh = new NodeMesh({ renderNode });
      expect(customMesh.getRenderNode()).toBe(renderNode);
    });

    it('should return stored component via getComponent', () => {
      const component = () => null;
      const customMesh = new NodeMesh({ component });
      expect(customMesh.getComponent()).toBe(component);
    });

    it('should return stored hitboxRadius via getHitboxRadius with default 20', () => {
      const customMesh = new NodeMesh({ style: 'custom' });
      expect(customMesh.getHitboxRadius()).toBe(20);
    });

    it('should return custom hitboxRadius via getHitboxRadius', () => {
      const customMesh = new NodeMesh({ style: 'custom', hitboxRadius: 50 });
      expect(customMesh.getHitboxRadius()).toBe(50);
    });
  });
});
