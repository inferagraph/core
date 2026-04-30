import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 5 Subagent B test: SceneController dispatch + layout-replay
 * for the inferred-edge overlay. The mock surface mirrors
 * `SceneController.dispatch.test.ts` (the dispatch parent test) and
 * adds `LineDashedMaterial` for InferredEdgeMesh.
 */
vi.mock('three', () => {
  const Vector3 = vi.fn().mockImplementation(function (
    this: { x: number; y: number; z: number },
    x?: number,
    y?: number,
    z?: number,
  ) {
    this.x = x ?? 0;
    this.y = y ?? 0;
    this.z = z ?? 0;
    const self = this as unknown as Record<string, unknown>;
    self.set = vi.fn().mockImplementation((nx: number, ny: number, nz: number) => {
      this.x = nx; this.y = ny; this.z = nz;
      return this;
    });
    self.lengthSq = vi.fn().mockImplementation(() => this.x ** 2 + this.y ** 2 + this.z ** 2);
    self.length = vi.fn().mockImplementation(() => Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2));
    self.setLength = vi.fn().mockImplementation((len: number) => {
      const l = Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2) || 1;
      this.x *= len / l; this.y *= len / l; this.z *= len / l;
      return this;
    });
    self.distanceTo = vi.fn().mockReturnValue(100);
    self.clone = vi.fn().mockReturnValue({ x: this.x, y: this.y, z: this.z });
    self.copy = vi.fn().mockImplementation((v: { x: number; y: number; z: number }) => {
      this.x = v.x; this.y = v.y; this.z = v.z;
      return this;
    });
    self.project = vi.fn().mockImplementation(() => {
      this.x = 0; this.y = 0; this.z = 0;
      return this;
    });
    return this;
  });
  return {
    Scene: vi.fn().mockImplementation(() => ({
      add: vi.fn(), remove: vi.fn(), background: null, children: [],
    })),
    PerspectiveCamera: class {
      position = { x: 0, y: 0, z: 100, set: vi.fn(), clone: vi.fn().mockReturnValue({ x: 0, y: 0, z: 100 }), distanceTo: vi.fn().mockReturnValue(100), copy: vi.fn().mockReturnThis() };
      quaternion = { x: 0, y: 0, z: 0, w: 1, set: vi.fn() };
      up = { x: 0, y: 1, z: 0, set: vi.fn().mockReturnThis(), clone: vi.fn().mockReturnValue({ x: 0, y: 1, z: 0 }), copy: vi.fn().mockReturnThis() };
      aspect = 1;
      fov = 60;
      lookAt = vi.fn();
      updateProjectionMatrix = vi.fn();
      matrixWorld = { elements: new Array(16).fill(0) };
      getWorldDirection = vi.fn().mockReturnValue({ x: 0, y: 0, z: -1 });
    },
    OrthographicCamera: class {
      position = { x: 0, y: 0, z: 0, set: vi.fn(), clone: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }), distanceTo: vi.fn().mockReturnValue(100), copy: vi.fn().mockReturnThis() };
      quaternion = { x: 0, y: 0, z: 0, w: 1, set: vi.fn() };
      up = { x: 0, y: 1, z: 0, set: vi.fn().mockReturnThis(), clone: vi.fn().mockReturnValue({ x: 0, y: 1, z: 0 }), copy: vi.fn().mockReturnThis() };
      left = -1; right = 1; top = 1; bottom = -1;
      zoom = 1;
      lookAt = vi.fn();
      updateProjectionMatrix = vi.fn();
      matrixWorld = { elements: new Array(16).fill(0) };
    },
    WebGLRenderer: vi.fn().mockImplementation(() => ({
      setSize: vi.fn(), setPixelRatio: vi.fn(), render: vi.fn(), dispose: vi.fn(),
      domElement: document.createElement('canvas'),
    })),
    Color: vi.fn().mockImplementation(() => ({ r: 0, g: 0, b: 0, set: vi.fn() })),
    AmbientLight: vi.fn().mockImplementation(() => ({})),
    DirectionalLight: vi.fn().mockImplementation(() => ({ position: { set: vi.fn() } })),
    InstancedMesh: vi.fn().mockImplementation((_geo, _mat, count) => ({
      count, instanceMatrix: { needsUpdate: false }, instanceColor: { needsUpdate: false },
      setMatrixAt: vi.fn(), setColorAt: vi.fn(),
      geometry: { dispose: vi.fn() }, material: { dispose: vi.fn() },
    })),
    InstancedBufferAttribute: vi.fn().mockImplementation((arr: Float32Array, size: number) => ({
      array: arr, itemSize: size, needsUpdate: false,
    })),
    SphereGeometry: vi.fn().mockImplementation(() => {
      const attributes: Record<string, unknown> = {};
      return {
        attributes,
        setAttribute: vi.fn().mockImplementation((name: string, attr: unknown) => { attributes[name] = attr; }),
        getAttribute: vi.fn().mockImplementation((name: string) => attributes[name]),
        dispose: vi.fn(),
      };
    }),
    ShapeGeometry: vi.fn().mockImplementation(() => ({
      setAttribute: vi.fn(), getAttribute: vi.fn(), dispose: vi.fn(),
    })),
    Shape: vi.fn().mockImplementation(() => ({
      moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(),
      getPoints: vi.fn().mockReturnValue([{ x: 0, y: 0 }, { x: 1, y: 0 }]),
    })),
    Group: vi.fn().mockImplementation(() => ({
      name: '', userData: {}, position: { set: vi.fn(), x: 0, y: 0, z: 0 },
      visible: true, add: vi.fn(), remove: vi.fn(), children: [],
    })),
    Mesh: vi.fn().mockImplementation((geo, mat) => ({
      geometry: geo, material: mat, renderOrder: 0, position: { set: vi.fn(), x: 0, y: 0, z: 0 },
    })),
    LineLoop: vi.fn().mockImplementation((geo, mat) => ({ geometry: geo, material: mat, renderOrder: 0 })),
    MeshBasicMaterial: vi.fn().mockImplementation(() => ({
      dispose: vi.fn(), color: { set: vi.fn() }, transparent: false, opacity: 1,
    })),
    DoubleSide: 2,
    MeshPhongMaterial: vi.fn().mockImplementation(() => ({
      dispose: vi.fn(), color: { set: vi.fn() },
    })),
    LineSegments: vi.fn().mockImplementation(function (this: object, geo: unknown, mat: unknown) {
      const self = this as Record<string, unknown>;
      self.geometry = geo;
      self.material = mat;
      self.visible = true;
      self.computeLineDistances = vi.fn();
      return this;
    }),
    BufferGeometry: vi.fn().mockImplementation(function (this: object) {
      const positionArr = new Float32Array(1024);
      const colorArr = new Float32Array(2048);
      const positionAttr = { array: positionArr, itemSize: 3, needsUpdate: false };
      const colorAttr = { array: colorArr, itemSize: 4, needsUpdate: false };
      Object.assign(this, {
        setAttribute: vi.fn(),
        getAttribute: vi.fn().mockImplementation((name: string) => {
          if (name === 'position') return positionAttr;
          if (name === 'color') return colorAttr;
          return null;
        }),
        dispose: vi.fn(), setDrawRange: vi.fn(),
        setFromPoints: vi.fn().mockReturnThis(),
      });
      return this;
    }),
    LineBasicMaterial: vi.fn().mockImplementation(() => ({
      dispose: vi.fn(), color: { set: vi.fn() }, opacity: 1,
    })),
    LineDashedMaterial: vi.fn().mockImplementation((opts) => ({
      dispose: vi.fn(),
      color: opts?.color,
      dashSize: opts?.dashSize,
      gapSize: opts?.gapSize,
      transparent: opts?.transparent,
      opacity: opts?.opacity,
      depthWrite: opts?.depthWrite,
    })),
    Float32BufferAttribute: vi.fn().mockImplementation((arr, size) => ({
      array: arr, itemSize: size, needsUpdate: false,
    })),
    PlaneGeometry: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
    CanvasTexture: vi.fn().mockImplementation(() => ({ dispose: vi.fn(), needsUpdate: false })),
    Matrix4: vi.fn().mockImplementation(() => ({ compose: vi.fn().mockReturnThis() })),
    Vector3,
    Vector2: vi.fn().mockImplementation((x?: number, y?: number) => ({ x: x ?? 0, y: y ?? 0 })),
    Quaternion: vi.fn().mockImplementation(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    Raycaster: vi.fn().mockImplementation(() => ({
      setFromCamera: vi.fn(), intersectObjects: vi.fn().mockReturnValue([]),
    })),
  };
});

vi.mock('three/examples/jsm/controls/TrackballControls.js', () => ({
  TrackballControls: vi.fn().mockImplementation((camera: unknown, dom: HTMLElement) => ({
    camera, domElement: dom,
    target: {
      x: 0, y: 0, z: 0,
      set: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number }, x: number, y: number, z: number) {
        this.x = x; this.y = y; this.z = z;
        return this;
      }),
      clone: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0, copy: vi.fn().mockReturnThis() }),
      copy: vi.fn().mockReturnThis(),
    },
    rotateSpeed: 1, zoomSpeed: 1, panSpeed: 1, dynamicDampingFactor: 0,
    noRotate: false,
    update: vi.fn(), reset: vi.fn(), dispose: vi.fn(), handleResize: vi.fn(),
  })),
}));

import { GraphStore } from '../../src/store/GraphStore.js';
import { SceneController } from '../../src/renderer/SceneController.js';
import type { GraphData } from '../../src/types.js';
import type { InferredEdge } from '../../src/ai/InferredEdge.js';

function makeContainer(width = 800, height = 600): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  return el;
}

const sample: GraphData = {
  nodes: [
    { id: 'a', attributes: { name: 'A', type: 'person' } },
    { id: 'b', attributes: { name: 'B', type: 'person' } },
    { id: 'c', attributes: { name: 'C', type: 'place' } },
  ],
  edges: [
    { id: 'e1', sourceId: 'a', targetId: 'b', attributes: { type: 'rel' } },
    { id: 'e2', sourceId: 'b', targetId: 'c', attributes: { type: 'rel' } },
  ],
};

function makeInferred(sourceId: string, targetId: string): InferredEdge {
  return {
    sourceId, targetId,
    type: 'related_to',
    score: 0.5,
    sources: ['graph'],
  };
}

describe('SceneController inferred-edge dispatch', () => {
  let store: GraphStore;
  let container: HTMLElement;
  let ctrl: SceneController;

  beforeEach(() => {
    store = new GraphStore();
    store.loadData(sample);
    container = makeContainer();
    document.body.innerHTML = '';
    document.body.appendChild(container);
    ctrl = new SceneController({ store });
    ctrl.attach(container);
    ctrl.syncFromStore();
  });

  describe('initial state', () => {
    it('mounts an InferredEdgeMesh in graph mode', () => {
      expect(ctrl.getInferredEdgeMesh()).not.toBeNull();
    });

    it('starts hidden by default (matches showInferredEdges=false plan default)', () => {
      expect(ctrl.getInferredEdgeVisibility()).toBe(false);
    });

    it('starts with no cached inferred edges', () => {
      expect(ctrl.getInferredEdges()).toEqual([]);
    });
  });

  describe('setInferredEdges (graph mode)', () => {
    it('caches the input for later replay', () => {
      const positions = new Map([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      const edges = [makeInferred('a', 'b')];
      ctrl.setInferredEdges(edges, positions);
      expect(ctrl.getInferredEdges()).toEqual(edges);
    });

    it('dispatches to the active InferredEdgeMesh', () => {
      const mesh = ctrl.getInferredEdgeMesh()!;
      const spy = vi.spyOn(mesh, 'setInferredEdges');
      const positions = new Map([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      ctrl.setInferredEdges([makeInferred('a', 'b')], positions);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('snapshots the input so caller mutations do not leak into the cache', () => {
      const positions = new Map([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      const edges: InferredEdge[] = [makeInferred('a', 'b')];
      ctrl.setInferredEdges(edges, positions);
      edges.push(makeInferred('b', 'c'));
      expect(ctrl.getInferredEdges()).toHaveLength(1);
    });
  });

  describe('setInferredEdgeVisibility (graph mode)', () => {
    it('round-trips the visibility flag', () => {
      ctrl.setInferredEdgeVisibility(true);
      expect(ctrl.getInferredEdgeVisibility()).toBe(true);
      ctrl.setInferredEdgeVisibility(false);
      expect(ctrl.getInferredEdgeVisibility()).toBe(false);
    });

    it('dispatches to the active InferredEdgeMesh', () => {
      const mesh = ctrl.getInferredEdgeMesh()!;
      const spy = vi.spyOn(mesh, 'setVisibility');
      ctrl.setInferredEdgeVisibility(true);
      expect(spy).toHaveBeenCalledWith(true);
    });
  });

  describe('layout-toggle replay', () => {
    it('preserves cached inferred edges across graph→tree→graph round-trip', () => {
      const positions = new Map([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      const edges = [makeInferred('a', 'b')];
      ctrl.setInferredEdges(edges, positions);
      ctrl.setInferredEdgeVisibility(true);

      // Toggle to tree (overlay tears down, cache survives) and back.
      ctrl.setLayout('tree');
      expect(ctrl.getInferredEdgeMesh()).toBeNull();
      expect(ctrl.getInferredEdges()).toEqual(edges);
      expect(ctrl.getInferredEdgeVisibility()).toBe(true);

      ctrl.setLayout('graph');
      const replayed = ctrl.getInferredEdgeMesh();
      expect(replayed).not.toBeNull();
      // Cached visibility should have been replayed onto the new mesh.
      expect(replayed!.isVisible()).toBe(true);
    });

    it('replays the cached visibility after a graph→graph rebuild', () => {
      ctrl.setInferredEdgeVisibility(true);
      // Force a rebuild via setLayout round-trip.
      ctrl.setLayout('tree');
      ctrl.setLayout('graph');
      expect(ctrl.getInferredEdgeMesh()!.isVisible()).toBe(true);
    });

    it('replays cached edges after a graph→tree→graph round-trip', () => {
      const positions = new Map([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      const edges = [makeInferred('a', 'b')];
      ctrl.setInferredEdges(edges, positions);
      ctrl.setLayout('tree');
      ctrl.setLayout('graph');
      const replayed = ctrl.getInferredEdgeMesh()!;
      expect(replayed.getEdges()).toHaveLength(1);
    });
  });

  describe('tree-mode no-op (Phase 5 plan: deferred to Phase 6)', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      ctrl.setLayout('tree');
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    });

    it('setInferredEdges in tree mode logs a debug note and updates the cache only', () => {
      const positions = new Map([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      ctrl.setInferredEdges([makeInferred('a', 'b')], positions);
      expect(consoleSpy).toHaveBeenCalled();
      const msg = String(consoleSpy.mock.calls[0]?.[0] ?? '');
      expect(msg.toLowerCase()).toContain('tree');
      // Cache still updates so a later graph re-entry can replay.
      expect(ctrl.getInferredEdges()).toHaveLength(1);
    });

    it('setInferredEdgeVisibility in tree mode logs a debug note and updates cache only', () => {
      ctrl.setInferredEdgeVisibility(true);
      expect(consoleSpy).toHaveBeenCalled();
      expect(ctrl.getInferredEdgeVisibility()).toBe(true);
    });

    it('does not allocate an InferredEdgeMesh in tree mode', () => {
      expect(ctrl.getInferredEdgeMesh()).toBeNull();
    });
  });

  describe('detach', () => {
    it('clears the inferred-edge cache + mesh on detach', () => {
      const positions = new Map([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      ctrl.setInferredEdges([makeInferred('a', 'b')], positions);
      ctrl.setInferredEdgeVisibility(true);
      ctrl.detach();
      expect(ctrl.getInferredEdgeMesh()).toBeNull();
      expect(ctrl.getInferredEdges()).toEqual([]);
      expect(ctrl.getInferredEdgeVisibility()).toBe(false);
    });
  });
});
