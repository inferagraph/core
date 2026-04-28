import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock three.js the same way WebGLRenderer.test.ts does so jsdom doesn't try
// to actually create a WebGL context.
vi.mock('three', () => ({
  Scene: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    remove: vi.fn(),
    background: null,
    children: [],
  })),
  PerspectiveCamera: vi.fn().mockImplementation(() => ({
    position: { set: vi.fn(), x: 0, y: 0, z: 0 },
    aspect: 1,
    updateProjectionMatrix: vi.fn(),
    lookAt: vi.fn(),
    matrixWorld: {},
    getWorldDirection: vi.fn(),
  })),
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
  SphereGeometry: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
  ShapeGeometry: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
  Shape: vi.fn().mockImplementation(() => ({
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
  })),
  MeshPhongMaterial: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    color: { set: vi.fn() },
  })),
  LineSegments: vi.fn().mockImplementation((geo, mat) => ({ geometry: geo, material: mat })),
  BufferGeometry: vi.fn().mockImplementation(() => {
    const positions = new Float32Array(1024);
    const positionAttr = { array: positions, itemSize: 3, needsUpdate: false };
    return {
      setAttribute: vi.fn(),
      getAttribute: vi.fn(() => positionAttr),
      dispose: vi.fn(),
      setDrawRange: vi.fn(),
    };
  }),
  LineBasicMaterial: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    color: { set: vi.fn() },
  })),
  Float32BufferAttribute: vi.fn().mockImplementation((arr, size) => ({
    array: arr,
    itemSize: size,
    needsUpdate: false,
  })),
  Matrix4: vi.fn().mockImplementation(() => ({ compose: vi.fn().mockReturnThis() })),
  Vector3: vi.fn().mockImplementation((x, y, z) => ({
    x: x ?? 0,
    y: y ?? 0,
    z: z ?? 0,
    set: vi.fn(),
    setFromMatrixColumn: vi.fn(),
  })),
  Quaternion: vi.fn().mockImplementation(() => ({ x: 0, y: 0, z: 0, w: 1 })),
}));

import { GraphStore } from '../../src/store/GraphStore.js';
import { SceneController } from '../../src/renderer/SceneController.js';
import { ForceLayout3D } from '../../src/layouts/ForceLayout3D.js';
import { TreeLayout } from '../../src/layouts/TreeLayout.js';
import type { GraphData } from '../../src/types.js';

function makeContainer(width = 800, height = 600): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  return el;
}

function seedStore(store: GraphStore, data: GraphData): void {
  store.loadData(data);
}

const sample: GraphData = {
  nodes: [
    { id: 'a', attributes: { name: 'A' } },
    { id: 'b', attributes: { name: 'B' } },
    { id: 'c', attributes: { name: 'C' } },
  ],
  edges: [
    { id: 'e1', sourceId: 'a', targetId: 'b', attributes: { type: 'rel' } },
    { id: 'e2', sourceId: 'b', targetId: 'c', attributes: { type: 'rel' } },
  ],
};

describe('SceneController', () => {
  let store: GraphStore;
  let container: HTMLElement;

  beforeEach(() => {
    store = new GraphStore();
    container = makeContainer();
    document.body.innerHTML = '';
    document.body.appendChild(container);
  });

  it('defaults to the force-3d (graph) layout', () => {
    const ctrl = new SceneController({ store });
    expect(ctrl.getLayoutMode()).toBe('graph');
    expect(ctrl.getLayoutEngine()).toBeInstanceOf(ForceLayout3D);
  });

  it('honors an explicit tree layout', () => {
    const ctrl = new SceneController({ store, layout: 'tree' });
    expect(ctrl.getLayoutMode()).toBe('tree');
    expect(ctrl.getLayoutEngine()).toBeInstanceOf(TreeLayout);
  });

  it('attaches the WebGL renderer to the supplied container', () => {
    const ctrl = new SceneController({ store });
    ctrl.attach(container);
    expect(ctrl.getRenderer().getContainer()).toBe(container);
    // Mounting also injects the Three.js canvas.
    expect(container.querySelector('canvas')).not.toBeNull();
    ctrl.detach();
  });

  it('attach is idempotent', () => {
    const ctrl = new SceneController({ store });
    ctrl.attach(container);
    ctrl.attach(container);
    expect(ctrl.getRenderer().getContainer()).toBe(container);
    ctrl.detach();
  });

  it('detach tears down the renderer', () => {
    const ctrl = new SceneController({ store });
    ctrl.attach(container);
    ctrl.detach();
    expect(ctrl.getRenderer().getContainer()).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('syncFromStore is a no-op when not attached', () => {
    seedStore(store, sample);
    const ctrl = new SceneController({ store });
    expect(() => ctrl.syncFromStore()).not.toThrow();
  });

  it('syncFromStore builds node + edge meshes from store contents', () => {
    seedStore(store, sample);
    const ctrl = new SceneController({ store });
    ctrl.attach(container);
    const computeSpy = vi.spyOn(ctrl.getLayoutEngine(), 'compute');

    ctrl.syncFromStore();

    expect(computeSpy).toHaveBeenCalledTimes(1);
    expect(computeSpy.mock.calls[0][0]).toEqual(['a', 'b', 'c']);

    ctrl.detach();
  });

  it('syncFromStore is idempotent — calling twice rebuilds without throwing', () => {
    seedStore(store, sample);
    const ctrl = new SceneController({ store });
    ctrl.attach(container);
    ctrl.syncFromStore();
    expect(() => ctrl.syncFromStore()).not.toThrow();
    ctrl.detach();
  });

  it('syncFromStore handles an empty store gracefully', () => {
    const ctrl = new SceneController({ store });
    ctrl.attach(container);
    expect(() => ctrl.syncFromStore()).not.toThrow();
    ctrl.detach();
  });

  it('setLayout swaps engines and recomputes positions', () => {
    seedStore(store, sample);
    const ctrl = new SceneController({ store });
    ctrl.attach(container);
    ctrl.syncFromStore();

    expect(ctrl.getLayoutEngine()).toBeInstanceOf(ForceLayout3D);
    ctrl.setLayout('tree');
    expect(ctrl.getLayoutEngine()).toBeInstanceOf(TreeLayout);
    expect(ctrl.getLayoutMode()).toBe('tree');

    ctrl.detach();
  });

  it('setLayout is a no-op when called with the current mode', () => {
    const ctrl = new SceneController({ store, layout: 'graph' });
    const before = ctrl.getLayoutEngine();
    ctrl.setLayout('graph');
    expect(ctrl.getLayoutEngine()).toBe(before);
  });

  it('setNodeRender stores the new config', () => {
    const ctrl = new SceneController({ store });
    const cfg = { style: 'card' as const, cardWidth: 100, cardHeight: 40 };
    ctrl.setNodeRender(cfg);
    expect(ctrl.getNodeRender()).toEqual(cfg);
  });

  it('setNodeRender on a mounted controller triggers a mesh rebuild', () => {
    seedStore(store, sample);
    const ctrl = new SceneController({ store });
    ctrl.attach(container);
    ctrl.syncFromStore();

    const computeSpy = vi.spyOn(ctrl.getLayoutEngine(), 'compute');
    ctrl.setNodeRender({ style: 'card' });
    // syncFromStore() is called internally → compute is invoked again.
    expect(computeSpy).toHaveBeenCalled();

    ctrl.detach();
  });

  it('setTooltip stores the new config', () => {
    const ctrl = new SceneController({ store });
    const cfg = { renderTooltip: vi.fn() };
    ctrl.setTooltip(cfg);
    expect(ctrl.getTooltip()).toBe(cfg);
  });

  it('resize delegates to the WebGL renderer', () => {
    const ctrl = new SceneController({ store });
    ctrl.attach(container);
    const spy = vi.spyOn(ctrl.getRenderer(), 'resize');
    ctrl.resize();
    expect(spy).toHaveBeenCalled();
    ctrl.detach();
  });
});
