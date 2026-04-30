import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reuse the same Three.js mock surface as SceneController.test.ts. Only the
// minimum needed to construct + attach + run a tick.
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
      this.x = nx;
      this.y = ny;
      this.z = nz;
      return this;
    });
    self.lengthSq = vi.fn().mockImplementation(() => this.x ** 2 + this.y ** 2 + this.z ** 2);
    self.length = vi.fn().mockImplementation(() => Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2));
    self.setLength = vi.fn().mockImplementation((len: number) => {
      const l = Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2) || 1;
      this.x *= len / l;
      this.y *= len / l;
      this.z *= len / l;
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
      add: vi.fn(),
      remove: vi.fn(),
      background: null,
      children: [],
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
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
      domElement: document.createElement('canvas'),
    })),
    Color: vi.fn().mockImplementation(() => ({ r: 0, g: 0, b: 0, set: vi.fn() })),
    AmbientLight: vi.fn().mockImplementation(() => ({})),
    DirectionalLight: vi.fn().mockImplementation(() => ({ position: { set: vi.fn() } })),
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
    ShapeGeometry: vi.fn().mockImplementation(() => ({
      setAttribute: vi.fn(),
      getAttribute: vi.fn(),
      dispose: vi.fn(),
    })),
    Shape: vi.fn().mockImplementation(() => ({
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      getPoints: vi.fn().mockReturnValue([{ x: 0, y: 0 }, { x: 1, y: 0 }]),
    })),
    Group: vi.fn().mockImplementation(() => ({
      name: '',
      userData: {},
      position: { set: vi.fn(), x: 0, y: 0, z: 0 },
      visible: true,
      add: vi.fn(),
      remove: vi.fn(),
      children: [],
    })),
    Mesh: vi.fn().mockImplementation((geo, mat) => ({
      geometry: geo,
      material: mat,
      renderOrder: 0,
      position: { set: vi.fn(), x: 0, y: 0, z: 0 },
    })),
    LineLoop: vi.fn().mockImplementation((geo, mat) => ({ geometry: geo, material: mat, renderOrder: 0 })),
    MeshBasicMaterial: vi.fn().mockImplementation(() => ({
      dispose: vi.fn(),
      color: { set: vi.fn() },
      transparent: false,
      opacity: 1,
    })),
    DoubleSide: 2,
    MeshPhongMaterial: vi.fn().mockImplementation(() => ({
      dispose: vi.fn(),
      color: { set: vi.fn() },
    })),
    LineSegments: vi.fn().mockImplementation((geo, mat) => ({ geometry: geo, material: mat })),
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
        dispose: vi.fn(),
        setDrawRange: vi.fn(),
        setFromPoints: vi.fn().mockReturnThis(),
      });
      return this;
    }),
    LineBasicMaterial: vi.fn().mockImplementation(() => ({
      dispose: vi.fn(),
      color: { set: vi.fn() },
      opacity: 1,
    })),
    Float32BufferAttribute: vi.fn().mockImplementation((arr, size) => ({
      array: arr,
      itemSize: size,
      needsUpdate: false,
    })),
    PlaneGeometry: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
    CanvasTexture: vi.fn().mockImplementation(() => ({ dispose: vi.fn(), needsUpdate: false })),
    Matrix4: vi.fn().mockImplementation(() => ({ compose: vi.fn().mockReturnThis() })),
    Vector3,
    Vector2: vi.fn().mockImplementation((x?: number, y?: number) => ({ x: x ?? 0, y: y ?? 0 })),
    Quaternion: vi.fn().mockImplementation(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    Raycaster: vi.fn().mockImplementation(() => ({
      setFromCamera: vi.fn(),
      intersectObjects: vi.fn().mockReturnValue([]),
    })),
  };
});

vi.mock('three/examples/jsm/controls/TrackballControls.js', () => ({
  TrackballControls: vi.fn().mockImplementation((camera: unknown, dom: HTMLElement) => ({
    camera,
    domElement: dom,
    target: {
      x: 0, y: 0, z: 0,
      set: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number }, x: number, y: number, z: number) {
        this.x = x; this.y = y; this.z = z;
        return this;
      }),
      clone: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0, copy: vi.fn().mockReturnThis() }),
      copy: vi.fn().mockReturnThis(),
    },
    rotateSpeed: 1,
    zoomSpeed: 1,
    panSpeed: 1,
    dynamicDampingFactor: 0,
    noRotate: false,
    update: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    handleResize: vi.fn(),
  })),
}));

import { GraphStore } from '../../src/store/GraphStore.js';
import { SceneController } from '../../src/renderer/SceneController.js';
import type { GraphData } from '../../src/types.js';

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

describe('SceneController dispatch surfaces', () => {
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

  describe('setHighlight', () => {
    it('starts with an empty highlight set', () => {
      expect(Array.from(ctrl.getHighlight())).toEqual([]);
    });

    it('round-trips highlight ids', () => {
      ctrl.setHighlight(new Set(['a', 'b']));
      expect(Array.from(ctrl.getHighlight()).sort()).toEqual(['a', 'b']);
    });

    it('dispatches to the active NodeMesh', () => {
      const nodeMesh = (ctrl as unknown as {
        nodeMesh: { setHighlight: (s: ReadonlySet<string>) => void } | null;
      }).nodeMesh;
      expect(nodeMesh).not.toBeNull();
      const spy = vi.spyOn(nodeMesh!, 'setHighlight');
      ctrl.setHighlight(new Set(['a']));
      expect(spy).toHaveBeenCalled();
      const arg = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(arg.has('a')).toBe(true);
    });

    it('dispatches to the active EdgeMesh', () => {
      const edgeMesh = (ctrl as unknown as {
        edgeMesh: { setHighlight: (s: ReadonlySet<string>) => void } | null;
      }).edgeMesh;
      expect(edgeMesh).not.toBeNull();
      const spy = vi.spyOn(edgeMesh!, 'setHighlight');
      ctrl.setHighlight(new Set(['b']));
      expect(spy).toHaveBeenCalled();
    });

    it('takes a snapshot of the input set so caller mutations do not leak', () => {
      const ids = new Set(['a']);
      ctrl.setHighlight(ids);
      ids.add('z');
      expect(ctrl.getHighlight().has('z')).toBe(false);
    });

    it('re-applies highlight after applyFilterMask', () => {
      ctrl.setHighlight(new Set(['a']));
      const nodeMesh = (ctrl as unknown as {
        nodeMesh: { setHighlight: (s: ReadonlySet<string>) => void } | null;
      }).nodeMesh!;
      const spy = vi.spyOn(nodeMesh, 'setHighlight');
      // Re-running setFilter triggers applyFilterMask which should
      // re-dispatch the highlight.
      ctrl.setFilter(undefined);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('focusOn', () => {
    it('is a no-op when nodeId is unknown', () => {
      const camera = ctrl.getCameraController();
      const spy = vi.spyOn(camera, 'focusOn');
      ctrl.focusOn('not-a-node');
      expect(spy).not.toHaveBeenCalled();
    });

    it('forwards to CameraController.focusOn for known nodes', () => {
      const camera = ctrl.getCameraController();
      const spy = vi.spyOn(camera, 'focusOn');
      ctrl.focusOn('a');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('annotate / clearAnnotations', () => {
    it('attaches a callout via the AnnotationRenderer', () => {
      ctrl.annotate('a', 'first');
      expect(ctrl.getAnnotationRenderer().getCount()).toBe(1);
    });

    it('clearAnnotations(id) removes one annotation', () => {
      ctrl.annotate('a', 'one');
      ctrl.annotate('b', 'two');
      ctrl.clearAnnotations('a');
      expect(ctrl.getAnnotationRenderer().getCount()).toBe(1);
      expect(ctrl.getAnnotationRenderer().getAnnotatedNodeIds()).toEqual(['b']);
    });

    it('clearAnnotations() clears all', () => {
      ctrl.annotate('a', 'one');
      ctrl.annotate('b', 'two');
      ctrl.clearAnnotations();
      expect(ctrl.getAnnotationRenderer().getCount()).toBe(0);
    });

    it('mounts the annotation overlay on attach', () => {
      expect(container.querySelector('.ig-annotation-overlay')).not.toBeNull();
    });

    it('removes the annotation overlay on detach', () => {
      ctrl.detach();
      expect(container.querySelector('.ig-annotation-overlay')).toBeNull();
    });
  });
});
