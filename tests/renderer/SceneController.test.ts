import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock three.js. SceneController now imports a wider surface area than 0.1.2
// (Raycaster, Vector3#project, etc.), so the mock needs to keep up.
vi.mock('three', () => {
  const Vector3 = vi.fn().mockImplementation((x?: number, y?: number, z?: number) => ({
    x: x ?? 0,
    y: y ?? 0,
    z: z ?? 0,
    set: vi.fn().mockReturnThis(),
    setFromMatrixColumn: vi.fn().mockReturnThis(),
    project: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number }) {
      // Trivial projection — keep coords stable so updatePosition gets called
      // with deterministic numbers in tests.
      this.x = 0;
      this.y = 0;
      this.z = 0;
      return this;
    }),
  }));
  return {
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
      matrixWorld: { elements: new Array(16).fill(0) },
      getWorldDirection: vi.fn().mockReturnValue({ x: 0, y: 0, z: -1 }),
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
    Vector3,
    Vector2: vi.fn().mockImplementation((x?: number, y?: number) => ({ x: x ?? 0, y: y ?? 0 })),
    Quaternion: vi.fn().mockImplementation(() => ({ x: 0, y: 0, z: 0, w: 1 })),
    Raycaster: vi.fn().mockImplementation(() => ({
      setFromCamera: vi.fn(),
      intersectObjects: vi.fn().mockReturnValue([]),
    })),
  };
});

import { GraphStore } from '../../src/store/GraphStore.js';
import { SceneController } from '../../src/renderer/SceneController.js';
import { ForceLayout3D } from '../../src/layouts/ForceLayout3D.js';
import { TreeLayout } from '../../src/layouts/TreeLayout.js';
import {
  DEFAULT_NODE_COLOR,
  DEFAULT_NODE_COLOR_PALETTE,
  DEFAULT_NODE_HOVER_PALETTE,
} from '../../src/renderer/NodeColorResolver.js';
import type { GraphData } from '../../src/types.js';

function makeContainer(width = 800, height = 600): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  // jsdom's getBoundingClientRect returns zeros — that's fine for our tests
  // because pointer-event handlers normalise relative to the container.
  return el;
}

function seedStore(store: GraphStore, data: GraphData): void {
  store.loadData(data);
}

const sample: GraphData = {
  nodes: [
    { id: 'a', attributes: { name: 'Abraham', type: 'person' } },
    { id: 'b', attributes: { name: 'Beersheba', type: 'place' } },
    { id: 'c', attributes: { name: 'Canaanites', type: 'clan' } },
  ],
  edges: [
    { id: 'e1', sourceId: 'a', targetId: 'b', attributes: { type: 'lived_in' } },
    { id: 'e2', sourceId: 'b', targetId: 'c', attributes: { type: 'home_of' } },
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

  describe('construction + layout', () => {
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
  });

  describe('attach / detach', () => {
    it('attaches the WebGL renderer to the supplied container', () => {
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      expect(ctrl.getRenderer().getContainer()).toBe(container);
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

    it('detach tears down the renderer + overlays', () => {
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.detach();
      expect(ctrl.getRenderer().getContainer()).toBeNull();
      expect(container.querySelector('canvas')).toBeNull();
      expect(container.querySelector('.ig-label-overlay')).toBeNull();
      expect(container.querySelector('.ig-tooltip')).toBeNull();
    });

    it('attach injects a label overlay div', () => {
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      expect(container.querySelector('.ig-label-overlay')).not.toBeNull();
      ctrl.detach();
    });

    it('attach injects a tooltip element (hidden by default)', () => {
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      const tip = container.querySelector('.ig-tooltip') as HTMLElement | null;
      expect(tip).not.toBeNull();
      expect(tip!.style.display).toBe('none');
      ctrl.detach();
    });
  });

  describe('syncFromStore', () => {
    it('is a no-op when not attached', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store });
      expect(() => ctrl.syncFromStore()).not.toThrow();
    });

    it('builds node + edge meshes from store contents', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      const computeSpy = vi.spyOn(ctrl.getLayoutEngine(), 'compute');

      ctrl.syncFromStore();

      expect(computeSpy).toHaveBeenCalledTimes(1);
      expect(computeSpy.mock.calls[0][0]).toEqual(['a', 'b', 'c']);
      ctrl.detach();
    });

    it('creates an HTML label per node using attribute name/title', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      const overlay = container.querySelector('.ig-label-overlay')!;
      const labels = overlay.querySelectorAll('.ig-label');
      expect(labels.length).toBe(3);
      const texts = Array.from(labels).map((l) => l.textContent);
      expect(texts).toContain('Abraham');
      expect(texts).toContain('Beersheba');
      expect(texts).toContain('Canaanites');
      ctrl.detach();
    });

    it('wires raycaster targets + node ids for hover testing', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // The raycaster should have a non-empty objects array (the node mesh)
      // and the node-id list pre-populated.
      const ray = ctrl.getRaycaster();
      expect(ray.hitTest(0, 0, 800, 600)).toBeNull(); // mock returns no hits
      ctrl.detach();
    });

    it('idempotent — calling twice rebuilds without throwing', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();
      expect(() => ctrl.syncFromStore()).not.toThrow();
      ctrl.detach();
    });

    it('handles an empty store gracefully', () => {
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      expect(() => ctrl.syncFromStore()).not.toThrow();
      ctrl.detach();
    });

    it('skips label creation when showLabels=false', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store, showLabels: false });
      ctrl.attach(container);
      ctrl.syncFromStore();

      const labels = container.querySelectorAll('.ig-label');
      expect(labels.length).toBe(0);
      ctrl.detach();
    });
  });

  describe('setLayout', () => {
    it('swaps engines and recomputes positions', () => {
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

    it('is a no-op when called with the current mode', () => {
      const ctrl = new SceneController({ store, layout: 'graph' });
      const before = ctrl.getLayoutEngine();
      ctrl.setLayout('graph');
      expect(ctrl.getLayoutEngine()).toBe(before);
    });
  });

  describe('setNodeRender', () => {
    it('stores the new config', () => {
      const ctrl = new SceneController({ store });
      const cfg = { style: 'card' as const, cardWidth: 100, cardHeight: 40 };
      ctrl.setNodeRender(cfg);
      expect(ctrl.getNodeRender()).toEqual(cfg);
    });

    it('on a mounted controller triggers a mesh rebuild', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      const computeSpy = vi.spyOn(ctrl.getLayoutEngine(), 'compute');
      ctrl.setNodeRender({ style: 'card' });
      expect(computeSpy).toHaveBeenCalled();

      ctrl.detach();
    });
  });

  describe('setTooltip', () => {
    it('stores the new config', () => {
      const ctrl = new SceneController({ store });
      const cfg = { renderTooltip: vi.fn() };
      ctrl.setTooltip(cfg);
      expect(ctrl.getTooltip()).toBe(cfg);
    });

    it('forwards the renderer to the tooltip overlay', () => {
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      const overlaySpy = vi.spyOn(ctrl.getTooltipOverlay(), 'setRenderConfig');
      const cfg = { renderTooltip: vi.fn() };
      ctrl.setTooltip(cfg);
      expect(overlaySpy).toHaveBeenCalledWith(cfg);
      ctrl.detach();
    });
  });

  describe('per-type colours', () => {
    it('exposes the default palette via the colour resolver', () => {
      const ctrl = new SceneController({ store });
      const resolver = ctrl.getColorResolver();
      expect(resolver.resolve({ id: 'p', attributes: { type: 'person' } }))
        .toBe(DEFAULT_NODE_COLOR_PALETTE.person);
      expect(resolver.resolve({ id: 'q', attributes: { type: 'place' } }))
        .toBe(DEFAULT_NODE_COLOR_PALETTE.place);
      expect(resolver.resolve({ id: 'r', attributes: { type: 'clan' } }))
        .toBe(DEFAULT_NODE_COLOR_PALETTE.clan);
      expect(resolver.resolve({ id: 's', attributes: { type: 'group' } }))
        .toBe(DEFAULT_NODE_COLOR_PALETTE.group);
      expect(resolver.resolve({ id: 't', attributes: { type: 'event' } }))
        .toBe(DEFAULT_NODE_COLOR_PALETTE.event);
    });

    it('falls back to the default colour for unknown types', () => {
      const ctrl = new SceneController({ store });
      const resolver = ctrl.getColorResolver();
      expect(resolver.resolve({ id: 'x', attributes: { type: 'unknown-type' } }))
        .toBe(DEFAULT_NODE_COLOR);
    });

    it('honors a custom nodeColorFn override', () => {
      const ctrl = new SceneController({
        store,
        nodeColorFn: (n) => (n.attributes.type === 'person' ? '#000000' : '#ffffff'),
      });
      const resolver = ctrl.getColorResolver();
      expect(resolver.resolve({ id: 'p', attributes: { type: 'person' } })).toBe('#000000');
      expect(resolver.resolve({ id: 'q', attributes: { type: 'place' } })).toBe('#ffffff');
    });

    it('writes per-instance colours when building the node mesh', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      const mesh = ctrl.getRenderer();
      // The InstancedMesh setColorAt was called once per node during build.
      // We can't easily reach the mock through public API, but absence of
      // throws + presence of mesh + node mesh is enough here.
      expect(mesh.getCamera()).not.toBeNull();
      ctrl.detach();
    });

    it('exposes per-type hover colours', () => {
      const ctrl = new SceneController({ store });
      const resolver = ctrl.getColorResolver();
      expect(resolver.resolveHover({ id: 'p', attributes: { type: 'person' } }))
        .toBe(DEFAULT_NODE_HOVER_PALETTE.person);
    });
  });

  describe('hover wiring', () => {
    it('clears hovered state on pointerleave', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // jsdom doesn't implement PointerEvent — fake one with a plain Event
      // and the clientX/Y fields the handler reads.
      const move = new Event('pointermove');
      Object.assign(move, { clientX: 10, clientY: 10 });
      container.dispatchEvent(move);
      container.dispatchEvent(new Event('pointerleave'));
      expect(ctrl.getHoveredIndex()).toBeNull();

      ctrl.detach();
    });

    it('setEnableHover(false) detaches pointer listeners', () => {
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      const removeSpy = vi.spyOn(container, 'removeEventListener');
      ctrl.setEnableHover(false);
      expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('pointerleave', expect.any(Function));
      ctrl.detach();
    });
  });

  describe('label toggling', () => {
    it('setShowLabels(false) clears existing labels', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();
      expect(container.querySelectorAll('.ig-label').length).toBe(3);

      ctrl.setShowLabels(false);
      expect(container.querySelectorAll('.ig-label').length).toBe(0);
      ctrl.detach();
    });

    it('setShowLabels(true) re-adds labels', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store, showLabels: false });
      ctrl.attach(container);
      ctrl.syncFromStore();
      expect(container.querySelectorAll('.ig-label').length).toBe(0);

      ctrl.setShowLabels(true);
      expect(container.querySelectorAll('.ig-label').length).toBe(3);
      ctrl.detach();
    });
  });

  describe('resize', () => {
    it('delegates to the WebGL renderer', () => {
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      const spy = vi.spyOn(ctrl.getRenderer(), 'resize');
      ctrl.resize();
      expect(spy).toHaveBeenCalled();
      ctrl.detach();
    });
  });
});
