import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reuse the same Three.js mock surface as SceneController.dispatch.test.ts.
// Only the minimum needed to construct + attach + run a tick.
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
    // Project to a deterministic NDC-space value so screen coords are
    // computable in tests. We just zero out z and leave x/y alone (they
    // start at the world coords and we'd normally apply the camera matrix —
    // for tests the identity-ish behaviour is enough).
    self.project = vi.fn().mockImplementation(() => {
      this.z = 0;
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

describe('SceneController "+" affordance integration', () => {
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

  it('mounts the affordance overlay on attach', () => {
    expect(container.querySelector('.ig-affordance-overlay')).not.toBeNull();
    expect(container.querySelector('.ig-expand-affordance')).not.toBeNull();
  });

  it('removes the affordance overlay on detach', () => {
    ctrl.detach();
    expect(container.querySelector('.ig-affordance-overlay')).toBeNull();
    expect(container.querySelector('.ig-expand-affordance')).toBeNull();
  });

  it('hover-enter shows the affordance with the hovered node id', () => {
    // Drive hover through the internal state: SceneController.updateHover
    // pulls from `this.raycaster`; spy on that and force a hit.
    const raycaster = ctrl.getRaycaster();
    vi.spyOn(raycaster, 'hitTest').mockReturnValue('a');

    // Inject pointer state + run one tick (which invokes updateHover).
    (ctrl as unknown as { pointerActive: boolean }).pointerActive = true;
    (ctrl as unknown as { pointerX: number }).pointerX = 100;
    (ctrl as unknown as { pointerY: number }).pointerY = 100;
    (ctrl as unknown as { tick: () => void }).tick();

    expect(ctrl.getHoveredIndex()).not.toBeNull();
    const aff = ctrl.getExpandAffordance();
    expect(aff.getCurrentNodeId()).toBe('a');
    expect(aff.getButton()!.style.display).toBe('flex');
  });

  it('hover-exit hides the affordance', () => {
    const raycaster = ctrl.getRaycaster();
    const hitSpy = vi.spyOn(raycaster, 'hitTest').mockReturnValue('a');

    (ctrl as unknown as { pointerActive: boolean }).pointerActive = true;
    (ctrl as unknown as { pointerX: number }).pointerX = 100;
    (ctrl as unknown as { pointerY: number }).pointerY = 100;
    (ctrl as unknown as { tick: () => void }).tick();

    const aff = ctrl.getExpandAffordance();
    expect(aff.getCurrentNodeId()).toBe('a');

    // Now the raycast misses — hover-exit path through clearHover.
    hitSpy.mockReturnValue(null);
    (ctrl as unknown as { tick: () => void }).tick();

    expect(aff.getCurrentNodeId()).toBeNull();
    expect(aff.getButton()!.style.display).toBe('none');
  });

  it('tick() updates the affordance position only when a node is hovered', () => {
    const aff = ctrl.getExpandAffordance();
    const updateSpy = vi.spyOn(aff, 'updatePosition');

    // No hover: tick should not project the affordance.
    (ctrl as unknown as { tick: () => void }).tick();
    expect(updateSpy).not.toHaveBeenCalled();

    // Hover 'b' and tick — affordance should now project.
    const raycaster = ctrl.getRaycaster();
    vi.spyOn(raycaster, 'hitTest').mockReturnValue('b');
    (ctrl as unknown as { pointerActive: boolean }).pointerActive = true;
    (ctrl as unknown as { pointerX: number }).pointerX = 50;
    (ctrl as unknown as { pointerY: number }).pointerY = 50;
    (ctrl as unknown as { tick: () => void }).tick();

    expect(updateSpy).toHaveBeenCalled();
  });

  it('clicking the affordance fires the registered onExpandRequest handler with the node id', () => {
    const handler = vi.fn();
    ctrl.setOnExpandRequest(handler);

    // Hover 'c' so the affordance has a current node.
    const raycaster = ctrl.getRaycaster();
    vi.spyOn(raycaster, 'hitTest').mockReturnValue('c');
    (ctrl as unknown as { pointerActive: boolean }).pointerActive = true;
    (ctrl as unknown as { pointerX: number }).pointerX = 10;
    (ctrl as unknown as { pointerY: number }).pointerY = 10;
    (ctrl as unknown as { tick: () => void }).tick();

    const button = ctrl.getExpandAffordance().getButton()!;
    button.click();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('c');
  });

  it('affordance click bypasses the canvas-level click (stopPropagation)', () => {
    const canvasClick = vi.fn();
    container.addEventListener('click', canvasClick);
    ctrl.setOnExpandRequest(() => undefined);

    // Force-show the affordance for 'a'.
    ctrl.getExpandAffordance().show('a');
    const button = ctrl.getExpandAffordance().getButton()!;
    button.click();

    expect(canvasClick).not.toHaveBeenCalled();
    container.removeEventListener('click', canvasClick);
  });

  it('setOnExpandRequest(null) clears the handler so subsequent clicks no-op', () => {
    const handler = vi.fn();
    ctrl.setOnExpandRequest(handler);
    ctrl.setOnExpandRequest(null);

    ctrl.getExpandAffordance().show('a');
    ctrl.getExpandAffordance().getButton()!.click();

    expect(handler).not.toHaveBeenCalled();
  });
});
