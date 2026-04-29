import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRender = vi.fn();
const mockSetSize = vi.fn();
const mockSetPixelRatio = vi.fn();
const mockDispose = vi.fn();
const mockSceneAdd = vi.fn();
const mockSceneRemove = vi.fn();
const mockUpdateProjectionMatrix = vi.fn();

vi.mock('three', () => {
  // Real classes (not arrow factories) so `instanceof THREE.PerspectiveCamera`
  // / `instanceof THREE.OrthographicCamera` in source code can succeed against
  // the mocked constructors.
  class MockPerspectiveCamera {
    position: { set: ReturnType<typeof vi.fn>; x: number; y: number; z: number };
    aspect = 1;
    updateProjectionMatrix = mockUpdateProjectionMatrix;
    lookAt = vi.fn();
    constructor() {
      this.position = { set: vi.fn(), x: 0, y: 0, z: 0 };
    }
  }
  class MockOrthographicCamera {
    position: { set: ReturnType<typeof vi.fn>; x: number; y: number; z: number };
    left: number;
    right: number;
    top: number;
    bottom: number;
    zoom = 1;
    updateProjectionMatrix = mockUpdateProjectionMatrix;
    lookAt = vi.fn();
    constructor(left = -1, right = 1, top = 1, bottom = -1) {
      this.position = { set: vi.fn(), x: 0, y: 0, z: 0 };
      this.left = left;
      this.right = right;
      this.top = top;
      this.bottom = bottom;
    }
  }
  return {
  Scene: vi.fn().mockImplementation(() => ({
    add: mockSceneAdd,
    remove: mockSceneRemove,
    background: null,
    children: [],
  })),
  PerspectiveCamera: MockPerspectiveCamera,
  OrthographicCamera: MockOrthographicCamera,
  WebGLRenderer: vi.fn().mockImplementation(() => ({
    setSize: mockSetSize,
    setPixelRatio: mockSetPixelRatio,
    render: mockRender,
    dispose: mockDispose,
    domElement: document.createElement('canvas'),
  })),
  Color: vi.fn().mockImplementation(() => ({ r: 0, g: 0, b: 0, set: vi.fn() })),
  AmbientLight: vi.fn().mockImplementation(() => ({})),
  DirectionalLight: vi.fn().mockImplementation(() => ({
    position: { set: vi.fn() },
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
  SphereGeometry: vi.fn().mockImplementation(() => {
    const attributes: Record<string, unknown> = {};
    return {
      attributes,
      setAttribute: vi.fn().mockImplementation((name: string, attr: unknown) => {
        attributes[name] = attr;
      }),
      getAttribute: vi.fn().mockImplementation((name: string) => attributes[name]),
      dispose: vi.fn(),
    };
  }),
  InstancedBufferAttribute: vi.fn().mockImplementation((arr: Float32Array, size: number) => ({
    array: arr,
    itemSize: size,
    needsUpdate: false,
  })),
  MeshPhongMaterial: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    color: { set: vi.fn() },
  })),
  LineSegments: vi.fn().mockImplementation((geo, mat) => ({
    geometry: geo,
    material: mat,
  })),
  BufferGeometry: vi.fn().mockImplementation(() => ({
    setAttribute: vi.fn(),
    getAttribute: vi.fn(),
    dispose: vi.fn(),
    setDrawRange: vi.fn(),
  })),
  LineBasicMaterial: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    color: { set: vi.fn() },
  })),
  Float32BufferAttribute: vi.fn().mockImplementation((arr, size) => ({
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
    set: vi.fn(),
  })),
  Quaternion: vi.fn().mockImplementation(() => ({
    x: 0,
    y: 0,
    z: 0,
    w: 1,
  })),
  };
});

import { WebGLRenderer } from '../../src/renderer/WebGLRenderer.js';
import { NodeMesh } from '../../src/renderer/NodeMesh.js';
import { EdgeMesh } from '../../src/renderer/EdgeMesh.js';

describe('WebGLRenderer', () => {
  let renderer: WebGLRenderer;
  let container: HTMLElement;

  beforeEach(() => {
    renderer = new WebGLRenderer();
    container = document.createElement('div');
    // Mock clientWidth/clientHeight
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
    vi.clearAllMocks();
  });

  describe('attach/detach (backward compatibility)', () => {
    it('should attach to container', () => {
      renderer.attach(container);
      expect(renderer.getContainer()).toBe(container);
    });

    it('should detach', () => {
      renderer.attach(container);
      renderer.detach();
      expect(renderer.getContainer()).toBeNull();
    });

    it('should expose theme manager', () => {
      expect(renderer.getThemeManager()).toBeDefined();
    });
  });

  describe('Three.js scene setup', () => {
    it('should create scene on attach', () => {
      renderer.attach(container);
      expect(renderer.getScene()).not.toBeNull();
    });

    it('should create camera on attach', () => {
      renderer.attach(container);
      expect(renderer.getCamera()).not.toBeNull();
    });

    it('should add canvas to container on attach', () => {
      renderer.attach(container);
      // The mock Three.js WebGLRenderer creates a canvas domElement
      expect(container.querySelector('canvas')).not.toBeNull();
    });

    it('should set renderer size to container dimensions', () => {
      renderer.attach(container);
      expect(mockSetSize).toHaveBeenCalledWith(800, 600);
    });

    it('should add lights to scene', () => {
      renderer.attach(container);
      // AmbientLight + key DirectionalLight + fill DirectionalLight = 3 calls
      // to scene.add. The 3-light rig gives the spheres clear shading
      // variation across their surface.
      expect(mockSceneAdd).toHaveBeenCalledTimes(3);
    });
  });

  describe('render', () => {
    it('should call Three.js renderer.render()', () => {
      renderer.attach(container);
      renderer.render();
      expect(mockRender).toHaveBeenCalled();
    });

    it('should not throw when rendering without attach', () => {
      expect(() => renderer.render()).not.toThrow();
    });
  });

  describe('render loop', () => {
    it('should start render loop', () => {
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
      renderer.attach(container);
      renderer.startRenderLoop();
      expect(rafSpy).toHaveBeenCalled();
      renderer.stopRenderLoop();
      rafSpy.mockRestore();
    });

    it('should stop render loop', () => {
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(42);
      const cafSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
      renderer.attach(container);
      renderer.startRenderLoop();
      renderer.stopRenderLoop();
      expect(cafSpy).toHaveBeenCalledWith(42);
      rafSpy.mockRestore();
      cafSpy.mockRestore();
    });

    it('should not start duplicate loops', () => {
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
      renderer.attach(container);
      renderer.startRenderLoop();
      renderer.startRenderLoop(); // second call should be ignored
      expect(rafSpy).toHaveBeenCalledTimes(1);
      renderer.stopRenderLoop();
      rafSpy.mockRestore();
    });
  });

  describe('node mesh management', () => {
    it('should add node mesh', () => {
      renderer.attach(container);
      const nodeMesh = new NodeMesh();
      nodeMesh.createInstancedMesh(10);
      renderer.addNodeMesh('node-1', nodeMesh);
      // scene.add should have been called for the mesh (+ lights from attach)
      expect(mockSceneAdd).toHaveBeenCalled();
    });

    it('should remove node mesh', () => {
      renderer.attach(container);
      const nodeMesh = new NodeMesh();
      nodeMesh.createInstancedMesh(10);
      renderer.addNodeMesh('node-1', nodeMesh);
      renderer.removeNodeMesh('node-1');
      expect(mockSceneRemove).toHaveBeenCalled();
    });

    it('should not throw when removing non-existent node mesh', () => {
      renderer.attach(container);
      expect(() => renderer.removeNodeMesh('nonexistent')).not.toThrow();
    });
  });

  describe('edge mesh management', () => {
    it('should add edge mesh', () => {
      renderer.attach(container);
      const edgeMesh = new EdgeMesh();
      edgeMesh.createLineSegments(5);
      renderer.addEdgeMesh('edge-1', edgeMesh);
      expect(mockSceneAdd).toHaveBeenCalled();
    });

    it('should remove edge mesh', () => {
      renderer.attach(container);
      const edgeMesh = new EdgeMesh();
      edgeMesh.createLineSegments(5);
      renderer.addEdgeMesh('edge-1', edgeMesh);
      renderer.removeEdgeMesh('edge-1');
      expect(mockSceneRemove).toHaveBeenCalled();
    });

    it('should not throw when removing non-existent edge mesh', () => {
      renderer.attach(container);
      expect(() => renderer.removeEdgeMesh('nonexistent')).not.toThrow();
    });
  });

  describe('batch position updates', () => {
    it('should update node positions', () => {
      renderer.attach(container);
      const nodeMesh = new NodeMesh();
      renderer.addNodeMesh('node-1', nodeMesh);

      const positions = new Map<string, { x: number; y: number; z: number }>();
      positions.set('node-1', { x: 10, y: 20, z: 30 });
      renderer.updateNodePositions(positions);

      expect(nodeMesh.getPosition()).toEqual({ x: 10, y: 20, z: 30 });
    });

    it('should skip missing nodes in position update', () => {
      renderer.attach(container);
      const positions = new Map<string, { x: number; y: number; z: number }>();
      positions.set('nonexistent', { x: 10, y: 20, z: 30 });
      expect(() => renderer.updateNodePositions(positions)).not.toThrow();
    });
  });

  describe('background color', () => {
    it('should set background color', () => {
      renderer.attach(container);
      renderer.setBackgroundColor('#ff0000');
      const scene = renderer.getScene();
      expect(scene).not.toBeNull();
      // scene.background was set to a new Color
      expect(scene!.background).toBeDefined();
    });
  });

  describe('resize', () => {
    it('should update camera aspect and renderer size', () => {
      renderer.attach(container);
      vi.clearAllMocks();

      Object.defineProperty(container, 'clientWidth', { value: 1024, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 768, configurable: true });

      renderer.resize();

      const camera = renderer.getCamera();
      expect(camera!.aspect).toBe(1024 / 768);
      expect(mockUpdateProjectionMatrix).toHaveBeenCalled();
      expect(mockSetSize).toHaveBeenCalledWith(1024, 768);
    });

    it('should not throw when resizing without attach', () => {
      expect(() => renderer.resize()).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should dispose Three.js renderer on detach', () => {
      renderer.attach(container);
      renderer.detach();
      expect(mockDispose).toHaveBeenCalled();
    });

    it('should remove canvas from container on detach', () => {
      renderer.attach(container);
      expect(container.querySelector('canvas')).not.toBeNull();
      renderer.detach();
      expect(container.querySelector('canvas')).toBeNull();
    });

    it('should clear scene on detach', () => {
      renderer.attach(container);
      renderer.detach();
      expect(renderer.getScene()).toBeNull();
    });

    it('should clear camera on detach', () => {
      renderer.attach(container);
      renderer.detach();
      expect(renderer.getCamera()).toBeNull();
    });

    it('should stop render loop on detach', () => {
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(42);
      const cafSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
      renderer.attach(container);
      renderer.startRenderLoop();
      renderer.detach();
      expect(cafSpy).toHaveBeenCalledWith(42);
      rafSpy.mockRestore();
      cafSpy.mockRestore();
    });
  });

  describe('tick callbacks', () => {
    it('invokes registered callbacks on each animation frame', () => {
      // Drive the loop synchronously by stubbing rAF to invoke once.
      let frameCb: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => {
          if (!frameCb) frameCb = cb;
          return 1;
        });

      renderer.attach(container);
      const tick = vi.fn();
      renderer.addTickCallback(tick);
      renderer.startRenderLoop();
      // Run one frame.
      frameCb?.(0);
      expect(tick).toHaveBeenCalledTimes(1);

      renderer.stopRenderLoop();
      rafSpy.mockRestore();
    });

    it('removeTickCallback prevents future invocations', () => {
      let frameCb: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => {
          frameCb = cb;
          return 1;
        });

      renderer.attach(container);
      const tick = vi.fn();
      renderer.addTickCallback(tick);
      renderer.removeTickCallback(tick);
      renderer.startRenderLoop();
      frameCb?.(0);
      expect(tick).not.toHaveBeenCalled();

      renderer.stopRenderLoop();
      rafSpy.mockRestore();
    });

    it('a throwing tick callback does not break the render loop', () => {
      let frameCb: FrameRequestCallback | null = null;
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => {
          frameCb = cb;
          return 1;
        });

      renderer.attach(container);
      renderer.addTickCallback(() => {
        throw new Error('boom');
      });
      const ok = vi.fn();
      renderer.addTickCallback(ok);
      renderer.startRenderLoop();
      expect(() => frameCb?.(0)).not.toThrow();
      expect(ok).toHaveBeenCalled();
      // render itself still runs.
      expect(mockRender).toHaveBeenCalled();

      renderer.stopRenderLoop();
      rafSpy.mockRestore();
    });
  });
});
