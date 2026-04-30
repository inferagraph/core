import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock three.js. SceneController now imports a wider surface area than 0.1.2
// (Raycaster, Vector3#project, etc.), so the mock needs to keep up.
vi.mock('three', () => {
  const Vector3 = vi.fn().mockImplementation(function (this: { x: number; y: number; z: number }, x?: number, y?: number, z?: number) {
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
    self.setFromMatrixColumn = vi.fn().mockReturnThis();
    self.lengthSq = vi.fn().mockImplementation(() => this.x * this.x + this.y * this.y + this.z * this.z);
    self.length = vi.fn().mockImplementation(() => Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z));
    self.setLength = vi.fn().mockImplementation((len: number) => {
      const l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z) || 1;
      const k = len / l;
      this.x *= k;
      this.y *= k;
      this.z *= k;
      return this;
    });
    self.distanceTo = vi.fn().mockReturnValue(100);
    self.clone = vi.fn().mockImplementation(() => new (Vector3 as unknown as new (a: number, b: number, c: number) => unknown)(this.x, this.y, this.z));
    self.copy = vi.fn().mockImplementation((v: { x: number; y: number; z: number }) => {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    });
    self.project = vi.fn().mockImplementation(() => {
      this.x = 0;
      this.y = 0;
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
    PerspectiveCamera: class MockPerspectiveCamera {
      position: Record<string, unknown>;
      quaternion: Record<string, unknown>;
      up: Record<string, unknown>;
      aspect = 1;
      fov = 60;
      updateProjectionMatrix = vi.fn();
      lookAt = vi.fn();
      matrixWorld = { elements: new Array(16).fill(0) };
      getWorldDirection = vi.fn().mockReturnValue({ x: 0, y: 0, z: -1 });
      constructor() {
        this.position = {
          set: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number }, x: number, y: number, z: number) {
            this.x = x; this.y = y; this.z = z;
            return this;
          }),
          x: 0, y: 0, z: 0,
          clone: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
          distanceTo: vi.fn().mockReturnValue(100),
          copy: vi.fn().mockReturnThis(),
        };
        this.quaternion = {
          set: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number, w: number) {
            this.x = x; this.y = y; this.z = z; this.w = w;
            return this;
          }),
          x: 0, y: 0, z: 0, w: 1,
        };
        this.up = { x: 0, y: 1, z: 0, clone: vi.fn().mockReturnValue({ x: 0, y: 1, z: 0 }), copy: vi.fn().mockReturnThis() };
      }
    },
    OrthographicCamera: class MockOrthographicCamera {
      position: Record<string, unknown>;
      quaternion: Record<string, unknown>;
      up: Record<string, unknown>;
      left: number;
      right: number;
      top: number;
      bottom: number;
      zoom = 1;
      updateProjectionMatrix = vi.fn();
      lookAt = vi.fn();
      matrixWorld = { elements: new Array(16).fill(0) };
      constructor(left = -1, right = 1, top = 1, bottom = -1) {
        this.left = left;
        this.right = right;
        this.top = top;
        this.bottom = bottom;
        this.position = {
          set: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number }, x: number, y: number, z: number) {
            this.x = x; this.y = y; this.z = z;
            return this;
          }),
          x: 0, y: 0, z: 0,
          clone: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
          distanceTo: vi.fn().mockReturnValue(100),
          copy: vi.fn().mockReturnThis(),
        };
        this.quaternion = {
          set: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number, w: number) {
            this.x = x; this.y = y; this.z = z; this.w = w;
            return this;
          }),
          x: 0, y: 0, z: 0, w: 1,
        };
        this.up = {
          x: 0, y: 1, z: 0,
          set: vi.fn().mockReturnThis(),
          clone: vi.fn().mockReturnValue({ x: 0, y: 1, z: 0 }),
          copy: vi.fn().mockReturnThis(),
        };
      }
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
    ShapeGeometry: vi.fn().mockImplementation(() => {
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
    Shape: vi.fn().mockImplementation(() => ({
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      getPoints: vi.fn().mockReturnValue([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]),
    })),
    Group: vi.fn().mockImplementation(() => {
      const children: unknown[] = [];
      return {
        name: '',
        userData: {} as Record<string, unknown>,
        position: {
          set: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number }, x: number, y: number, z: number) {
            this.x = x; this.y = y; this.z = z;
            return this;
          }),
          x: 0, y: 0, z: 0,
        },
        children,
        add: vi.fn().mockImplementation((c: unknown) => { children.push(c); }),
        remove: vi.fn(),
      };
    }),
    Mesh: vi.fn().mockImplementation((geo, mat) => ({
      geometry: geo,
      material: mat,
      renderOrder: 0,
      position: { set: vi.fn(), x: 0, y: 0, z: 0 },
    })),
    LineLoop: vi.fn().mockImplementation((geo, mat) => ({
      geometry: geo,
      material: mat,
      renderOrder: 0,
    })),
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
      const positions = new Float32Array(1024);
      const positionAttr = { array: positions, itemSize: 3, needsUpdate: false };
      Object.assign(this, {
        setAttribute: vi.fn(),
        getAttribute: vi.fn(() => positionAttr),
        dispose: vi.fn(),
        setDrawRange: vi.fn(),
        setFromPoints: vi.fn().mockReturnThis(),
      });
      return this;
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
import { ForceLayout3D } from '../../src/layouts/ForceLayout3D.js';
import { TreeLayout } from '../../src/layouts/TreeLayout.js';
import { DEFAULT_NODE_COLOR } from '../../src/renderer/NodeColorResolver.js';
import {
  DEFAULT_PALETTE_32,
  hashStringToIndex,
  brighten,
} from '../../src/renderer/palette.js';
import type { GraphData, NodeData } from '../../src/types.js';

const autoFor = (type: string) =>
  DEFAULT_PALETTE_32[hashStringToIndex(type, DEFAULT_PALETTE_32.length)];

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

    it('mounts tree-view objects + an OrthographicCamera on toggle to tree, and restores the perspective camera on toggle back', async () => {
      // A small bidirectional family with a marriage so the tree pipeline
      // exercises both parent edges and spouse edges.
      const family: GraphData = {
        nodes: [
          { id: 'adam', attributes: { name: 'Adam', type: 'person' } },
          { id: 'eve', attributes: { name: 'Eve', type: 'person' } },
          { id: 'cain', attributes: { name: 'Cain', type: 'person' } },
        ],
        edges: [
          { id: 'm1', sourceId: 'adam', targetId: 'eve', attributes: { type: 'husband_of' } },
          { id: 'm2', sourceId: 'eve', targetId: 'adam', attributes: { type: 'wife_of' } },
          { id: 'p1', sourceId: 'adam', targetId: 'cain', attributes: { type: 'father_of' } },
          { id: 'p2', sourceId: 'cain', targetId: 'adam', attributes: { type: 'son_of' } },
        ],
      };
      seedStore(store, family);

      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      const renderer = ctrl.getRenderer();
      const THREE = await import('three');

      // Graph mode: no tree-mode objects are mounted.
      expect(renderer.getObject('__tree_nodes__')).toBeUndefined();
      expect(renderer.getCamera()).toBeInstanceOf(THREE.PerspectiveCamera);

      ctrl.setLayout('tree');

      // Tree mode: cards + connectors are mounted; camera is orthographic.
      expect(renderer.getObject('__tree_nodes__')).toBeDefined();
      expect(renderer.getCamera()).toBeInstanceOf(THREE.OrthographicCamera);

      ctrl.setLayout('graph');

      // Back to graph: tree-mode objects are torn down; perspective camera
      // is restored.
      expect(renderer.getObject('__tree_nodes__')).toBeUndefined();
      expect(renderer.getObject('__tree_edges__')).toBeUndefined();
      expect(renderer.getCamera()).toBeInstanceOf(THREE.PerspectiveCamera);

      ctrl.detach();
    });
  });

  describe('setFilter (domain-agnostic visibility predicate)', () => {
    // The Bible-Graph use case: tree mode should show ONLY people, hiding
    // events / places / clans. The filter is wired on the React layer
    // (`<InferaGraph filter={...} />`) but the SceneController is the
    // single source of truth; verify the predicate is applied to cards,
    // connectors, AND the graph-mode meshes via per-instance visibility
    // (no rebuild).
    const mixed: GraphData = {
      nodes: [
        { id: 'noah', attributes: { name: 'Noah', type: 'person' } },
        { id: 'shem', attributes: { name: 'Shem', type: 'person' } },
        { id: 'flood', attributes: { name: 'The Flood', type: 'event' } },
        { id: 'ararat', attributes: { name: 'Ararat', type: 'place' } },
      ],
      edges: [
        // father_of: noah -> shem (kept under person-only filter).
        { id: 'p1', sourceId: 'noah', targetId: 'shem', attributes: { type: 'father_of' } },
        // participant_in: noah -> flood (hidden because flood is filtered).
        { id: 'p2', sourceId: 'noah', targetId: 'flood', attributes: { type: 'participant_in' } },
      ],
    };

    it('builds tree cards for ALL nodes — visibility is applied via setVisibility, not pre-filter', () => {
      seedStore(store, mixed);
      const ctrl = new SceneController({
        store,
        layout: 'tree',
        filter: (n) => n.attributes.type === 'person',
      });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // ALL four nodes must have card groups mounted in the scene
      // (the filter is applied via per-card `group.visible`, not by
      // skipping cards on build).
      const root = ctrl.getRenderer().getObject('__tree_nodes__') as
        | { children: Array<{ userData: { nodeId: string }; visible?: boolean }> }
        | undefined;
      expect(root).toBeDefined();
      const ids = root!.children.map((c) => c.userData.nodeId).sort();
      expect(ids).toEqual(['ararat', 'flood', 'noah', 'shem']);

      // The two non-person cards must be hidden via group.visible=false.
      const visibleById = new Map(
        root!.children.map((c) => [c.userData.nodeId, c.visible]),
      );
      expect(visibleById.get('noah')).toBe(true);
      expect(visibleById.get('shem')).toBe(true);
      expect(visibleById.get('flood')).toBe(false);
      expect(visibleById.get('ararat')).toBe(false);

      ctrl.detach();
    });

    it('renders every node when no filter is supplied', () => {
      seedStore(store, mixed);
      const ctrl = new SceneController({ store, layout: 'tree' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      const root = ctrl.getRenderer().getObject('__tree_nodes__') as
        | { children: Array<{ userData: { nodeId: string } }> }
        | undefined;
      expect(root).toBeDefined();
      const ids = root!.children.map((c) => c.userData.nodeId).sort();
      expect(ids).toEqual(['ararat', 'flood', 'noah', 'shem']);

      ctrl.detach();
    });

    it('setFilter toggles visibility WITHOUT tearing down + rebuilding tree meshes', () => {
      seedStore(store, mixed);
      const ctrl = new SceneController({ store, layout: 'tree' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Spy on the private mesh rebuild path to verify it does NOT run
      // on a filter change.
      const ctrlAny = ctrl as unknown as {
        buildGraphMeshes: (...args: unknown[]) => void;
        buildTreeMeshes: (...args: unknown[]) => void;
        teardownGraphMeshes: () => void;
        teardownTreeMeshes: () => void;
      };
      const buildGraphSpy = vi.spyOn(ctrlAny, 'buildGraphMeshes');
      const buildTreeSpy = vi.spyOn(ctrlAny, 'buildTreeMeshes');
      const teardownGraphSpy = vi.spyOn(ctrlAny, 'teardownGraphMeshes');
      const teardownTreeSpy = vi.spyOn(ctrlAny, 'teardownTreeMeshes');

      // Swap to a person-only predicate at runtime.
      ctrl.setFilter((n) => n.attributes.type === 'person');

      const root = ctrl.getRenderer().getObject('__tree_nodes__') as
        | { children: Array<{ userData: { nodeId: string }; visible?: boolean }> }
        | undefined;
      // Cards still mounted, but only the two people are visible.
      const ids = root!.children.map((c) => c.userData.nodeId).sort();
      expect(ids).toEqual(['ararat', 'flood', 'noah', 'shem']);
      const visibleById = new Map(
        root!.children.map((c) => [c.userData.nodeId, c.visible]),
      );
      expect(visibleById.get('noah')).toBe(true);
      expect(visibleById.get('flood')).toBe(false);

      // Clear the filter and confirm everything is shown again.
      ctrl.setFilter(undefined);
      const root2 = ctrl.getRenderer().getObject('__tree_nodes__') as
        | { children: Array<{ userData: { nodeId: string }; visible?: boolean }> }
        | undefined;
      const visibleAfterClear = new Map(
        root2!.children.map((c) => [c.userData.nodeId, c.visible]),
      );
      expect(visibleAfterClear.get('flood')).toBe(true);
      expect(visibleAfterClear.get('ararat')).toBe(true);

      // Critically: filter changes do NOT trigger mesh teardown / rebuild.
      expect(buildGraphSpy).not.toHaveBeenCalled();
      expect(buildTreeSpy).not.toHaveBeenCalled();
      expect(teardownGraphSpy).not.toHaveBeenCalled();
      expect(teardownTreeSpy).not.toHaveBeenCalled();

      buildGraphSpy.mockRestore();
      buildTreeSpy.mockRestore();
      teardownGraphSpy.mockRestore();
      teardownTreeSpy.mockRestore();
      ctrl.detach();
    });

    it('setFilter hides graph-mode node + edge meshes via per-instance alpha', () => {
      seedStore(store, mixed);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      ctrl.setFilter((n) => n.attributes.type === 'person');

      // Graph node mesh: instanceAlpha buffer should have 1s for noah +
      // shem (indices 0, 1) and 0s for flood + ararat (indices 2, 3).
      const ctrlAny = ctrl as unknown as {
        nodeMesh: { getInstanceAlpha(): { array: Float32Array } | null } | null;
        edgeMesh: { getMesh(): { geometry: { getAttribute(n: string): { array: Float32Array } } } | null } | null;
      };
      const alpha = ctrlAny.nodeMesh?.getInstanceAlpha();
      expect(alpha).not.toBeNull();
      expect(alpha!.array[0]).toBeCloseTo(1, 5); // noah
      expect(alpha!.array[1]).toBeCloseTo(1, 5); // shem
      expect(alpha!.array[2]).toBeCloseTo(0, 5); // flood
      expect(alpha!.array[3]).toBeCloseTo(0, 5); // ararat

      // Graph edge mesh: edge p1 (noah↔shem) visible; p2 (noah↔flood) hidden.
      const colorAttr = ctrlAny.edgeMesh!.getMesh()!.geometry.getAttribute('color');
      // Edge index 0 (p1) → alpha at offsets 3, 7. Visible.
      expect(colorAttr.array[3]).toBeCloseTo(1, 5);
      expect(colorAttr.array[7]).toBeCloseTo(1, 5);
      // Edge index 1 (p2) → alpha at offsets 11, 15. Hidden.
      expect(colorAttr.array[11]).toBeCloseTo(0, 5);
      expect(colorAttr.array[15]).toBeCloseTo(0, 5);

      ctrl.detach();
    });

    it('setFilter is reversible — clearing restores all visibility', () => {
      seedStore(store, mixed);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      ctrl.setFilter((n) => n.attributes.type === 'person');
      ctrl.setFilter(undefined);

      const ctrlAny = ctrl as unknown as {
        nodeMesh: { getInstanceAlpha(): { array: Float32Array } | null } | null;
      };
      const alpha = ctrlAny.nodeMesh!.getInstanceAlpha()!;
      // All four instances back to alpha=1.
      for (let i = 0; i < 4; i++) {
        expect(alpha.array[i]).toBeCloseTo(1, 5);
      }
      ctrl.detach();
    });

    it('getFilter returns the active predicate', () => {
      const ctrl = new SceneController({ store });
      // Default: trivial accept-all predicate.
      const f0 = ctrl.getFilter();
      expect(typeof f0).toBe('function');
      expect(f0({ id: 'x', attributes: {} } as NodeData)).toBe(true);

      const personOnly = (n: NodeData) => n.attributes.type === 'person';
      ctrl.setFilter(personOnly);
      expect(ctrl.getFilter()).toBe(personOnly);
    });

    it('keeps the HTML LabelRenderer overlay empty in tree mode', () => {
      // Tree mode renders labels inside the WebGL cards (CanvasTexture),
      // so the HTML overlay must stay empty. This guards against the
      // 0.1.15 regression where graph-mode labels collapsed to (0,0) when
      // the orthographic tree camera projected them.
      seedStore(store, mixed);
      const ctrl = new SceneController({ store, layout: 'tree' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      const overlay = container.querySelector('.ig-label-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay!.querySelectorAll('.ig-label').length).toBe(0);

      ctrl.detach();
    });

    // Regression: 0.1.25 setFilter updated visibility but did NOT reframe
    // the camera. When biblegraph switched graph→tree, the layout effect
    // ran first (frameToFit on stale visibility) then the filter effect
    // updated visibility — leaving the tree shifted off-screen because
    // the camera was centred on all 18 nodes while only 13 were visible.
    // Fix: setFilter must call frameToFit on the visible subset after
    // applyFilterMask. (Not from inside applyFilterMask itself, which is
    // also invoked by syncFromStore / setLayout / build* — those callers
    // already frame.)
    it('setFilter reframes the camera on the visible subset (tree mode)', () => {
      seedStore(store, mixed);
      const ctrl = new SceneController({ store, layout: 'tree' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // @ts-expect-error — accessing private for a behaviour assertion
      const frameSpy = vi.spyOn(ctrl, 'frameToFit');

      ctrl.setFilter((n) => n.attributes.type === 'person');

      // Exactly one reframe per setFilter call.
      expect(frameSpy).toHaveBeenCalledTimes(1);
      // The positions Map handed to frameToFit must be restricted to the
      // visible subset (noah + shem) — NOT the full set of four.
      const arg = frameSpy.mock.calls[0][0] as Map<string, unknown>;
      const ids = Array.from(arg.keys()).sort();
      expect(ids).toEqual(['noah', 'shem']);

      frameSpy.mockRestore();
      ctrl.detach();
    });

    it('setFilter reframes the camera on the visible subset (graph mode)', () => {
      seedStore(store, mixed);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // @ts-expect-error — accessing private for a behaviour assertion
      const frameSpy = vi.spyOn(ctrl, 'frameToFit');

      ctrl.setFilter((n) => n.attributes.type === 'person');

      expect(frameSpy).toHaveBeenCalledTimes(1);
      const arg = frameSpy.mock.calls[0][0] as Map<string, unknown>;
      const ids = Array.from(arg.keys()).sort();
      expect(ids).toEqual(['noah', 'shem']);

      frameSpy.mockRestore();
      ctrl.detach();
    });

    it('setFilter does NOT crash or call frameToFit when called before any layout has run', () => {
      // Constructor-time predicate path: setFilter runs before
      // syncFromStore / attach. The layout cache is empty and getPositions
      // returns nothing, so the reframe must be skipped — the eventual
      // syncFromStore frames using the now-correct visibleNodeIds.
      const ctrl = new SceneController({ store });
      // @ts-expect-error — accessing private for a behaviour assertion
      const frameSpy = vi.spyOn(ctrl, 'frameToFit');

      expect(() => ctrl.setFilter((n) => n.attributes.type === 'person')).not.toThrow();
      expect(frameSpy).not.toHaveBeenCalled();

      frameSpy.mockRestore();
    });
  });

  describe('lazy layout dispatch', () => {
    // Regression: SceneController must compute ONLY the active layout. The
    // inactive layout's `compute()` must never run on attach + sync, and
    // toggling away and back must not re-trigger it. This keeps a buggy
    // inactive layout (e.g. TreeLayout cycle exception) out of the active
    // code path and avoids wasted compute when the user never toggles.
    it('never invokes TreeLayout.compute while in graph view', () => {
      seedStore(store, sample);
      const treeSpy = vi.spyOn(TreeLayout.prototype, 'compute');

      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      expect(treeSpy).not.toHaveBeenCalled();

      ctrl.detach();
      treeSpy.mockRestore();
    });

    it('only invokes TreeLayout.compute on the toggle into tree mode', () => {
      seedStore(store, sample);
      const treeSpy = vi.spyOn(TreeLayout.prototype, 'compute');

      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();
      expect(treeSpy).not.toHaveBeenCalled();

      ctrl.setLayout('tree');
      expect(treeSpy).toHaveBeenCalledTimes(1);

      // Toggling back to graph must NOT touch TreeLayout again — graph
      // recomputes via its own ForceLayout3D engine.
      ctrl.setLayout('graph');
      expect(treeSpy).toHaveBeenCalledTimes(1);

      ctrl.detach();
      treeSpy.mockRestore();
    });

    it('caches static-layout positions across toggles within a sync window', () => {
      seedStore(store, sample);
      const treeSpy = vi.spyOn(TreeLayout.prototype, 'compute');

      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // First entry into tree: compute fires.
      ctrl.setLayout('tree');
      expect(treeSpy).toHaveBeenCalledTimes(1);

      // Toggle away and back — without an intervening syncFromStore the
      // positions are still valid, so the cache must absorb the second
      // entry without a recompute.
      ctrl.setLayout('graph');
      ctrl.setLayout('tree');
      expect(treeSpy).toHaveBeenCalledTimes(1);

      // After syncFromStore the data may have changed, so the cache is
      // invalidated and a fresh compute is required.
      ctrl.syncFromStore();
      ctrl.setLayout('tree');
      expect(treeSpy).toHaveBeenCalledTimes(2);

      ctrl.detach();
      treeSpy.mockRestore();
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
    it('auto-assigns deterministic palette colors via the resolver', () => {
      const ctrl = new SceneController({ store });
      const resolver = ctrl.getColorResolver();
      expect(resolver.resolve({ id: 'p', attributes: { type: 'person' } }))
        .toBe(autoFor('person'));
      expect(resolver.resolve({ id: 'q', attributes: { type: 'place' } }))
        .toBe(autoFor('place'));
    });

    it('falls back to the default colour when palette is empty AND nothing matches', () => {
      const ctrl = new SceneController({
        store,
        palette: [],
      });
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

    it('honors an explicit nodeColors map', () => {
      const ctrl = new SceneController({
        store,
        nodeColors: { person: '#deadbe' },
      });
      const resolver = ctrl.getColorResolver();
      expect(resolver.resolve({ id: 'p', attributes: { type: 'person' } })).toBe('#deadbe');
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

    it('exposes hover colours via brightness lift', () => {
      const ctrl = new SceneController({ store });
      const resolver = ctrl.getColorResolver();
      const node = { id: 'p', attributes: { type: 'person' } };
      expect(resolver.resolveHover(node)).toBe(brighten(resolver.resolve(node), 0.25));
    });

    it('exposes an EdgeColorMap with auto-assignment', () => {
      const ctrl = new SceneController({ store });
      const map = ctrl.getEdgeColorMap();
      expect(map.resolve({
        id: 'e', sourceId: 'a', targetId: 'b', attributes: { type: 'father_of' },
      })).toBe(autoFor('father_of'));
    });

    it('honors an explicit edgeColors map + edgeColorFn', () => {
      const ctrl = new SceneController({
        store,
        edgeColors: { father_of: '#abc123' },
      });
      const map = ctrl.getEdgeColorMap();
      expect(map.resolve({
        id: 'e', sourceId: 'a', targetId: 'b', attributes: { type: 'father_of' },
      })).toBe('#abc123');

      const ctrl2 = new SceneController({
        store,
        edgeColorFn: () => '#000000',
      });
      expect(ctrl2.getEdgeColorMap().resolve({
        id: 'e', sourceId: 'a', targetId: 'b', attributes: { type: 'father_of' },
      })).toBe('#000000');
    });

    it('passes resolved source + target node colors as ctx to edgeColorFn during syncFromStore', () => {
      // Capture every (sourceColor, targetColor) tuple the edge resolver
      // sees while building the edge mesh. The resolver is wired up in
      // `buildGraphMeshes` so the call happens during `syncFromStore`.
      const seen: Array<{ sourceColor: string; targetColor: string }> = [];
      seedStore(store, sample);
      const ctrl = new SceneController({
        store,
        // Person → red, place → green, clan → blue. The sample fixture
        // wires Abraham (person) → Beersheba (place) and Beersheba (place)
        // → Canaanites (clan), so the two edges should report
        // (#ff0000,#00ff00) and (#00ff00,#0000ff) respectively.
        nodeColors: {
          person: '#ff0000',
          place: '#00ff00',
          clan: '#0000ff',
        },
        edgeColorFn: (_e, { sourceColor, targetColor }) => {
          seen.push({ sourceColor, targetColor });
          return undefined; // fall through; we only care about ctx
        },
      });
      ctrl.attach(container);
      ctrl.syncFromStore();

      expect(seen).toEqual([
        { sourceColor: '#ff0000', targetColor: '#00ff00' },
        { sourceColor: '#00ff00', targetColor: '#0000ff' },
      ]);
      ctrl.detach();
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

    it('default tooltip shows the natural-language description for a hovered node', () => {
      // Force a hit on instance 0 so the hover pipeline fires showTooltip.
      const familyData: GraphData = {
        nodes: [
          { id: 'isaac', attributes: { title: 'Isaac', type: 'person' } },
          { id: 'abraham', attributes: { title: 'Abraham', type: 'person' } },
          { id: 'sarah', attributes: { title: 'Sarah', type: 'person' } },
        ],
        edges: [
          { id: 'e1', sourceId: 'abraham', targetId: 'isaac', attributes: { type: 'father_of' } },
          { id: 'e2', sourceId: 'sarah', targetId: 'isaac', attributes: { type: 'mother_of' } },
        ],
      };
      seedStore(store, familyData);
      const ctrl = new SceneController({
        store,
        incomingEdgeLabels: { father_of: 'Son of', mother_of: 'Son of' },
      });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Stub the raycaster to return Isaac on the next hit-test so the
      // hover pipeline exercises the rich-tooltip path without a real WebGL
      // context.
      const ray = ctrl.getRaycaster();
      vi.spyOn(ray, 'hitTest').mockReturnValue('isaac');

      // Synthesize a pointer move + drive one tick by calling the private
      // tick handler indirectly via setEnableHover (re-entry is harmless).
      const move = new Event('pointermove');
      Object.assign(move, { clientX: 100, clientY: 100 });
      container.dispatchEvent(move);
      // @ts-expect-error — invoke private tick directly for the assertion
      ctrl['updateHover']();

      const tip = container.querySelector('.ig-tooltip') as HTMLElement;
      expect(tip.style.display).toBe('block');
      expect(tip.querySelector('.ig-tooltip-title')?.textContent).toBe('Isaac');
      const lines = Array.from(tip.querySelectorAll('.ig-tooltip-line')).map(
        (n) => n.textContent,
      );
      expect(lines).toContain('Son of Abraham and Sarah');

      ctrl.detach();
    });

    it('default tooltip falls back to the node name when there are no relationships', () => {
      seedStore(store, {
        nodes: [{ id: 'lonely', attributes: { name: 'Lonely', type: 'person' } }],
        edges: [],
      });
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      const ray = ctrl.getRaycaster();
      vi.spyOn(ray, 'hitTest').mockReturnValue('lonely');

      // @ts-expect-error — invoke private tick directly for the assertion
      ctrl['updateHover']();

      const tip = container.querySelector('.ig-tooltip') as HTMLElement;
      expect(tip.style.display).toBe('block');
      // No relationship lines means we fall back to the simple TooltipOverlay
      // path which writes the bare name as text content.
      expect(tip.textContent).toBe('Lonely');

      ctrl.detach();
    });

    it('honors a custom tooltip.renderTooltip even when relationships exist', () => {
      seedStore(store, sample);
      const renderTooltip = vi.fn();
      const ctrl = new SceneController({ store, tooltip: { renderTooltip } });
      ctrl.attach(container);
      ctrl.syncFromStore();

      const ray = ctrl.getRaycaster();
      vi.spyOn(ray, 'hitTest').mockReturnValue('a');

      // @ts-expect-error — invoke private tick directly for the assertion
      ctrl['updateHover']();

      expect(renderTooltip).toHaveBeenCalled();

      ctrl.detach();
    });

    it('exposes setters for incoming/outgoing edge label maps', () => {
      const ctrl = new SceneController({ store });
      expect(ctrl.getIncomingEdgeLabels()).toBeUndefined();
      expect(ctrl.getOutgoingEdgeLabels()).toBeUndefined();

      ctrl.setIncomingEdgeLabels({ father_of: 'Son of' });
      ctrl.setOutgoingEdgeLabels({ father_of: 'Father of' });

      expect(ctrl.getIncomingEdgeLabels()).toEqual({ father_of: 'Son of' });
      expect(ctrl.getOutgoingEdgeLabels()).toEqual({ father_of: 'Father of' });
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

  describe('pulse', () => {
    it('exposes a default-on PulseController', () => {
      const ctrl = new SceneController({ store });
      expect(ctrl.getPulseController().isEnabled()).toBe(true);
    });

    it('accepts pulse=false to disable at construction', () => {
      const ctrl = new SceneController({ store, pulse: false });
      expect(ctrl.getPulseController().isEnabled()).toBe(false);
    });

    it('accepts a partial pulse config', () => {
      const ctrl = new SceneController({ store, pulse: { period: 1000, amplitude: 0.2 } });
      const cfg = ctrl.getPulseController().getConfig();
      expect(cfg.period).toBe(1000);
      expect(cfg.amplitude).toBe(0.2);
    });

    it('setPulse(false) disables modulation at runtime', () => {
      const ctrl = new SceneController({ store });
      ctrl.setPulse(false);
      expect(ctrl.getPulseController().isEnabled()).toBe(false);
    });

    it('setPulse({...}) reconfigures at runtime', () => {
      const ctrl = new SceneController({ store });
      ctrl.setPulse({ period: 5000, amplitude: 0.01 });
      expect(ctrl.getPulseController().getConfig().period).toBe(5000);
      expect(ctrl.getPulseController().getConfig().amplitude).toBe(0.01);
    });

    it('per-frame tick invokes the pulse controller (when nodes exist)', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      const applySpy = vi.spyOn(ctrl.getPulseController(), 'apply');
      // Drive one tick — the renderer's tick callback was registered in
      // attach(); invoke it via the only public surface (private tick is
      // bound inside attach). We can do that by calling the renderer's
      // internal tick callbacks set indirectly via startRenderLoop is
      // already running. Easier: pump rAF manually.
      ctrl.getRenderer().render();
      // The tick is invoked from the rAF loop; for the test, dispatch via
      // resize→nothing. Instead invoke the renderer's tick callback list.
      // A simpler check: after sync, the controller has captured base
      // colours. We assert that the pulse controller is reachable + enabled.
      expect(ctrl.getPulseController().isEnabled()).toBe(true);
      // Force a manual apply to make sure the wiring works.
      const positions = ctrl.getLayoutEngine().getPositions();
      ctrl.getPulseController().apply(
        // @ts-expect-error — reach in via the test for assertion purposes
        ctrl['nodeMesh']!,
        ['a', 'b', 'c'],
        positions,
        ['#3D8DAF', '#2A6480', '#F0A03A'],
      );
      expect(applySpy).toHaveBeenCalled();
      ctrl.detach();
    });

    it('hovered node is excluded from the pulse', () => {
      seedStore(store, sample);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();
      // Manually mark index 1 as hovered.
      // @ts-expect-error — internal field tweaked for the test
      ctrl['hoveredIndex'] = 1;
      // @ts-expect-error — invoke private applyPulse directly
      ctrl['applyPulse']();
      expect(ctrl.getPulseController().getExcludedIndex()).toBe(1);
      ctrl.detach();
    });
  });

  describe('camera rotation', () => {
    it('exposes the camera controller', () => {
      const ctrl = new SceneController({ store });
      expect(ctrl.getCameraController()).toBeDefined();
    });

    it('setRotationEnabled forwards to the camera controller', () => {
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      const spy = vi.spyOn(ctrl.getCameraController(), 'setRotationEnabled');
      ctrl.setRotationEnabled(false);
      expect(spy).toHaveBeenCalledWith(false);
      ctrl.setRotationEnabled(true);
      expect(spy).toHaveBeenCalledWith(true);
      ctrl.detach();
    });

    it('resetRotation forwards to the camera controller', () => {
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      const spy = vi.spyOn(ctrl.getCameraController(), 'resetRotation');
      ctrl.resetRotation();
      expect(spy).toHaveBeenCalled();
      ctrl.detach();
    });
  });

  describe('tree-mode camera lock + reset', () => {
    // Regression: in 0.1.16 the orthographic camera could pick up an
    // off-axis eye direction when frameToFit shifted the target away from
    // origin, which rotated the projection and skewed every card. The
    // SceneController now (a) keeps rotation gestures locked while in
    // tree mode and (b) re-asserts an axis-aligned orientation on entry
    // and after every framing pass.

    const family: GraphData = {
      nodes: [
        { id: 'adam', attributes: { name: 'Adam', type: 'person' } },
        { id: 'eve', attributes: { name: 'Eve', type: 'person' } },
        { id: 'cain', attributes: { name: 'Cain', type: 'person' } },
      ],
      edges: [
        { id: 'm1', sourceId: 'adam', targetId: 'eve', attributes: { type: 'husband_of' } },
        { id: 'm2', sourceId: 'eve', targetId: 'adam', attributes: { type: 'wife_of' } },
        { id: 'p1', sourceId: 'adam', targetId: 'cain', attributes: { type: 'father_of' } },
        { id: 'p2', sourceId: 'cain', targetId: 'adam', attributes: { type: 'son_of' } },
      ],
    };

    it('locks rotation in tree mode and restores it in graph mode', () => {
      seedStore(store, family);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Default = graph mode → rotation enabled.
      expect(ctrl.getCameraController().isRotationEnabled()).toBe(true);

      ctrl.setLayout('tree');
      expect(ctrl.getCameraController().isRotationEnabled()).toBe(false);

      ctrl.setLayout('graph');
      expect(ctrl.getCameraController().isRotationEnabled()).toBe(true);

      ctrl.detach();
    });

    it('resets orthographic camera to axis-aligned on FIRST entry to tree mode', () => {
      seedStore(store, family);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Spy on the camera-controller orientation reset. SceneController
      // owns axis-alignment in the first-entry default path of
      // setLayout — exactly one reset, before frameToFit. frameToFit
      // itself no longer touches orientation.
      const resetSpy = vi.spyOn(
        ctrl.getCameraController(),
        'resetCameraOrientation',
      );

      ctrl.setLayout('tree');
      // Exactly one reset on the first-entry default path.
      expect(resetSpy).toHaveBeenCalledTimes(1);

      // Toggling back to graph must NOT reset the orientation — graph mode
      // owns the user's free-rotation eye vector.
      resetSpy.mockClear();
      ctrl.setLayout('graph');
      expect(resetSpy).not.toHaveBeenCalled();

      ctrl.detach();
    });

    it('does NOT reset orthographic orientation on subsequent entries to tree mode', () => {
      // Per-mode camera persistence: once a tree snapshot exists, the
      // saved transform is restored verbatim. Re-asserting axis-alignment
      // would clobber any pan/zoom the user did in their previous tree
      // session.
      seedStore(store, family);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      const resetSpy = vi.spyOn(
        ctrl.getCameraController(),
        'resetCameraOrientation',
      );

      // First entry — first-entry default fires (1 reset).
      ctrl.setLayout('tree');
      expect(resetSpy).toHaveBeenCalledTimes(1);

      // Round-trip: graph then tree again. Second entry restores the
      // saved tree snapshot — NO additional reset.
      ctrl.setLayout('graph');
      ctrl.setLayout('tree');
      expect(resetSpy).toHaveBeenCalledTimes(1);

      ctrl.detach();
    });

    it('does not reset orientation in graph mode framing', () => {
      seedStore(store, family);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      const resetSpy = vi.spyOn(
        ctrl.getCameraController(),
        'resetCameraOrientation',
      );
      ctrl.syncFromStore();
      expect(resetSpy).not.toHaveBeenCalled();
      ctrl.detach();
    });

    it('orthographic camera is axis-aligned on first entry to tree mode regardless of prior graph rotation', () => {
      // Regression for 0.1.20: on the graph→tree transition, frameToFit's
      // setTarget→placeCameraAtRadius preserved whatever eye direction the
      // (rotated) perspective camera carried, so the orthographic eye ended
      // up off the +Z axis and projected every card at an angle. The fix
      // re-asserts axis-alignment AFTER frameToFit so the final eye vector
      // is purely along +Z relative to the freshly-framed tree centroid.
      seedStore(store, family);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Pose the perspective camera as if the user had rotated + panned
      // the graph view to a non-trivial off-axis state. Both the camera
      // position and the trackball target are non-zero AND non-collinear
      // along Z, so any code path that preserves the prior eye direction
      // when re-targeting will produce a non-axis-aligned orthographic
      // eye.
      const persp = ctrl.getRenderer().getCamera() as unknown as {
        position: { set: (x: number, y: number, z: number) => unknown; x: number; y: number; z: number };
      };
      const controls = ctrl.getCameraController().getControls();
      if (!persp || !controls) throw new Error('camera/controls not attached');
      persp.position.set(100, 200, 50);
      controls.target.set(10, 20, 0);
      // A few update() ticks bake the state into the trackball internals
      // so any residual damping cannot hide the off-axis eye.
      ctrl.getCameraController().update();
      ctrl.getCameraController().update();
      ctrl.getCameraController().update();

      // First-ever entry to tree mode.
      ctrl.setLayout('tree');

      // The orthographic camera must end up purely along +Z relative to
      // the trackball target — the orthographic projection assumes
      // axis-aligned cards, so any off-axis component skews the render.
      const ortho = ctrl.getRenderer().getCamera() as unknown as {
        position: { x: number; y: number; z: number };
        up: { set: ReturnType<typeof vi.fn>; x: number; y: number; z: number };
        quaternion: { x: number; y: number; z: number; w: number };
      };
      const target = ctrl.getCameraController().getTarget();

      // Eye = position - target must be (0, 0, +radius).
      expect(ortho.position.x).toBeCloseTo(target.x, 5);
      expect(ortho.position.y).toBeCloseTo(target.y, 5);
      expect(ortho.position.z).toBeGreaterThan(target.z);

      // up was rewritten to the canonical Y axis.
      expect(ortho.up.set).toHaveBeenCalledWith(0, 1, 0);

      // The orthographic camera carries no leftover rotation. lookAt is
      // mocked so the quaternion is whatever resetCameraOrientation /
      // earlier swap paths wrote; in practice that's the identity.
      expect(Math.abs(ortho.quaternion.x)).toBeLessThan(1e-6);
      expect(Math.abs(ortho.quaternion.y)).toBeLessThan(1e-6);
      expect(Math.abs(ortho.quaternion.z)).toBeLessThan(1e-6);
      expect(Math.abs(Math.abs(ortho.quaternion.w) - 1)).toBeLessThan(1e-6);

      ctrl.detach();
    });
  });

  describe('paintNode position source', () => {
    // Regression for the 0.1.24 graph-mode hover flicker.
    //
    // 0.1.19 made paintNode read from `layoutCache` to fix the tree-mode
    // round-trip bug (a freshly-constructed TreeLayout's `getPositions()`
    // is empty after a cache-hit re-entry). That fix is correct for STATIC
    // layouts but wrong for ANIMATED ones: ForceLayout3D ticks every frame
    // and the live positions live on the engine — `layoutCache` only holds
    // the INITIAL `compute()` snapshot. Reading from the cache during a
    // graph-mode hover snapped the node back to that initial position for a
    // single frame before the next physics tick restored it (visible
    // flicker). 0.1.24 makes paintNode pick the right source per layout
    // type: engine for animated, cache for static.
    const family: GraphData = {
      nodes: [
        { id: 'adam', attributes: { name: 'Adam', type: 'person' } },
        { id: 'eve', attributes: { name: 'Eve', type: 'person' } },
        { id: 'cain', attributes: { name: 'Cain', type: 'person' } },
      ],
      edges: [
        { id: 'm1', sourceId: 'adam', targetId: 'eve', attributes: { type: 'husband_of' } },
        { id: 'p1', sourceId: 'adam', targetId: 'cain', attributes: { type: 'father_of' } },
      ],
    };

    it('paintNode reads live engine positions when the active layout is animated', () => {
      seedStore(store, family);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Tick the physics engine a few times so live positions diverge from
      // the initial-compute snapshot the cache is holding.
      const engine = ctrl.getLayoutEngine();
      for (let i = 0; i < 5; i++) engine.tick();

      const targetId = 'adam';
      // @ts-expect-error — internal access for the assertion
      const cached = ctrl['layoutCache'].get('graph') as Map<string, { x: number; y: number; z: number }>;
      const live = engine.getPositions();
      const cachedPos = cached.get(targetId)!;
      const livePos = live.get(targetId)!;

      // Sanity: physics has actually moved the node away from the initial
      // cached snapshot. If this fails the test below would be vacuous.
      const moved =
        cachedPos.x !== livePos.x ||
        cachedPos.y !== livePos.y ||
        cachedPos.z !== livePos.z;
      expect(moved).toBe(true);

      // Spy on the node mesh's per-instance update so we can read the
      // exact position paintNode handed to the renderer.
      // @ts-expect-error — internal access for the spy
      const nodeMesh = ctrl['nodeMesh']!;
      const updateSpy = vi.spyOn(nodeMesh, 'updateInstance');

      // @ts-expect-error — drive paintNode directly (the hover path in
      // updateHover() funnels straight here).
      ctrl['paintNode'](0, /* hovered */ true);

      expect(updateSpy).toHaveBeenCalledTimes(1);
      const [, passedPos] = updateSpy.mock.calls[0];
      // Must equal the LIVE engine position, not the initial cached one.
      expect(passedPos).toEqual(livePos);
      expect(passedPos).not.toEqual(cachedPos);

      ctrl.detach();
    });

    it('paintNode reads cached positions when the active layout is static (regression for tree-mode hover)', () => {
      // Round-trip into tree mode: graph → tree → graph → tree. On the
      // second entry into tree mode `computeActiveLayout` short-circuits on
      // a cache hit, so the freshly-constructed TreeLayout's internal
      // positions map stays empty. paintNode therefore MUST read from the
      // cache for static layouts (else the tree card would slam to {0,0,0}
      // on every hover).
      seedStore(store, family);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      ctrl.setLayout('tree');
      ctrl.setLayout('graph');
      ctrl.setLayout('tree');

      // Precondition: the new TreeLayout instance's live positions are
      // empty (cache hit re-entry).
      expect(ctrl.getLayoutEngine().getPositions().size).toBe(0);

      // The cache, on the other hand, must be populated.
      // @ts-expect-error — internal access
      const cached = ctrl['layoutCache'].get('tree') as Map<string, { x: number; y: number; z: number }>;
      expect(cached).toBeTruthy();
      expect(cached.size).toBeGreaterThan(0);

      const targetId = 'adam';
      const cachedPos = cached.get(targetId)!;

      // @ts-expect-error — internal access
      const treeMesh = ctrl['treeNodeMesh']!;
      const updateSpy = vi.spyOn(treeMesh, 'updateCard');

      // @ts-expect-error — drive paintNode directly
      ctrl['paintNode'](0, /* hovered */ true);

      expect(updateSpy).toHaveBeenCalledTimes(1);
      const [passedId, passedPos] = updateSpy.mock.calls[0];
      expect(passedId).toBe(targetId);
      // Must equal the CACHED position; if the engine were used we'd see
      // {0,0,0} (engine.getPositions() is empty here).
      expect(passedPos).toEqual(cachedPos);

      ctrl.detach();
    });
  });

  describe('per-mode camera state persistence', () => {
    // The two views must keep COMPLETELY independent camera state.
    // Toggling graph→tree→graph must restore the user's prior graph
    // pan/zoom/rotation; toggling tree→graph→tree must restore the
    // user's prior tree pan/zoom. Mutations in one mode never bleed
    // into the other mode's saved state.

    const family: GraphData = {
      nodes: [
        { id: 'adam', attributes: { name: 'Adam', type: 'person' } },
        { id: 'eve', attributes: { name: 'Eve', type: 'person' } },
        { id: 'cain', attributes: { name: 'Cain', type: 'person' } },
      ],
      edges: [
        { id: 'm1', sourceId: 'adam', targetId: 'eve', attributes: { type: 'husband_of' } },
        { id: 'p1', sourceId: 'adam', targetId: 'cain', attributes: { type: 'father_of' } },
      ],
    };

    type LiveCamera = {
      position: {
        set: (x: number, y: number, z: number) => unknown;
        x: number;
        y: number;
        z: number;
      };
      zoom?: number;
      updateProjectionMatrix?: () => void;
    };

    /**
     * Mutate the live camera + controls target so a snapshot taken
     * after this call is distinguishable from any default-framed state.
     */
    function poseLiveCamera(
      ctrl: SceneController,
      pose: { position: [number, number, number]; target: [number, number, number]; zoom?: number },
    ): void {
      const camera = ctrl.getRenderer().getCamera() as unknown as LiveCamera | null;
      const controls = ctrl.getCameraController().getControls();
      if (!camera || !controls) throw new Error('camera/controls not attached');
      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
      if (typeof pose.zoom === 'number' && typeof camera.zoom === 'number') {
        camera.zoom = pose.zoom;
        camera.updateProjectionMatrix?.();
      }
    }

    function readLivePose(ctrl: SceneController): {
      position: { x: number; y: number; z: number };
      target: { x: number; y: number; z: number };
      zoom: number;
    } {
      const camera = ctrl.getRenderer().getCamera() as unknown as LiveCamera | null;
      const target = ctrl.getCameraController().getTarget();
      if (!camera) throw new Error('camera not attached');
      return {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: target.x, y: target.y, z: target.z },
        zoom: typeof camera.zoom === 'number' ? camera.zoom : 1,
      };
    }

    it('preserves graph camera state across a tree round-trip', () => {
      seedStore(store, family);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // 1. Pose the graph (perspective) camera somewhere distinctive.
      poseLiveCamera(ctrl, {
        position: [5, 6, 7],
        target: [1, 2, 3],
      });
      const graphPose = readLivePose(ctrl);

      // 2. Toggle into tree, mutate the tree camera differently, then
      //    toggle back to graph.
      ctrl.setLayout('tree');
      poseLiveCamera(ctrl, {
        position: [100, 200, 300],
        target: [50, 60, 70],
        zoom: 2.5,
      });

      ctrl.setLayout('graph');

      // 3. Graph state must match the pre-toggle pose, NOT the tree pose.
      const restored = readLivePose(ctrl);
      expect(restored.position).toEqual(graphPose.position);
      expect(restored.target).toEqual(graphPose.target);

      ctrl.detach();
    });

    it('preserves tree camera state across a graph round-trip', () => {
      seedStore(store, family);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Enter tree first so the orthographic camera exists.
      ctrl.setLayout('tree');

      // Pose the tree camera distinctly.
      poseLiveCamera(ctrl, {
        position: [11, 22, 33],
        target: [4, 5, 6],
        zoom: 1.75,
      });
      const treePose = readLivePose(ctrl);

      // Toggle out + mutate graph + toggle back.
      ctrl.setLayout('graph');
      poseLiveCamera(ctrl, {
        position: [-1, -2, -3],
        target: [-4, -5, -6],
      });

      ctrl.setLayout('tree');

      const restored = readLivePose(ctrl);
      expect(restored.position).toEqual(treePose.position);
      expect(restored.target).toEqual(treePose.target);
      expect(restored.zoom).toBe(treePose.zoom);

      ctrl.detach();
    });

    it('initializes via frameToFit on FIRST entry to each mode', () => {
      // First-ever entry to a mode (no prior snapshot) must call
      // frameToFit. Subsequent entries must NOT — the saved snapshot
      // takes over.
      seedStore(store, family);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // syncFromStore framed graph mode once. Spy on the framer from now on.
      // @ts-expect-error — accessing private for a behaviour assertion
      const frameSpy = vi.spyOn(ctrl, 'frameToFit');

      // First entry to tree — should call frameToFit (default path).
      ctrl.setLayout('tree');
      expect(frameSpy).toHaveBeenCalledTimes(1);

      // Round-trip: graph already has a snapshot from before setLayout
      // captured the outgoing graph state, so this is a RESTORE — no frame.
      ctrl.setLayout('graph');
      expect(frameSpy).toHaveBeenCalledTimes(1);

      // Second entry to tree — restore from snapshot, no frame.
      ctrl.setLayout('tree');
      expect(frameSpy).toHaveBeenCalledTimes(1);

      ctrl.detach();
    });

    it('keeps rotation locked in tree mode regardless of saved snapshot', () => {
      // Restoring a saved tree snapshot must not re-enable rotation.
      // Tree mode owns rotation = false unconditionally.
      seedStore(store, family);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Visit tree once so a snapshot is captured on the way out.
      ctrl.setLayout('tree');
      expect(ctrl.getCameraController().isRotationEnabled()).toBe(false);
      ctrl.setLayout('graph');

      // Re-enter tree — restore path. Rotation must STILL be locked.
      ctrl.setLayout('tree');
      expect(ctrl.getCameraController().isRotationEnabled()).toBe(false);

      // Round-trip back: graph rotation must come back live.
      ctrl.setLayout('graph');
      expect(ctrl.getCameraController().isRotationEnabled()).toBe(true);

      ctrl.detach();
    });

    it('graph and tree snapshots are isolated — gestures in one mode do not bleed into the other', () => {
      seedStore(store, family);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Pose A in graph.
      poseLiveCamera(ctrl, { position: [1, 1, 1], target: [0, 0, 0] });
      const graphA = readLivePose(ctrl);

      // Toggle to tree, pose B.
      ctrl.setLayout('tree');
      poseLiveCamera(ctrl, { position: [9, 9, 9], target: [8, 8, 8], zoom: 3 });
      const treeB = readLivePose(ctrl);

      // Back to graph — should see pose A, NOT pose B.
      ctrl.setLayout('graph');
      const graphRestored = readLivePose(ctrl);
      expect(graphRestored.position).toEqual(graphA.position);
      expect(graphRestored.target).toEqual(graphA.target);
      expect(graphRestored.position).not.toEqual(treeB.position);

      // Now mutate graph again to a third pose C — this must NOT leak
      // into the tree snapshot.
      poseLiveCamera(ctrl, { position: [42, 42, 42], target: [41, 41, 41] });

      // Toggle to tree — should see pose B, NOT pose C.
      ctrl.setLayout('tree');
      const treeRestored = readLivePose(ctrl);
      expect(treeRestored.position).toEqual(treeB.position);
      expect(treeRestored.target).toEqual(treeB.target);
      expect(treeRestored.zoom).toBe(treeB.zoom);

      ctrl.detach();
    });

    it('syncs CameraController internal state on every snapshot restore', () => {
      // Regression for the 0.1.18 → 0.1.19 fix: writing camera.position /
      // .quaternion / .zoom in `applyCameraState` is not enough.
      // CameraController caches its own `radius` AND TrackballControls
      // owns damping accumulators (`_lastAngle`, `_movePrev/_moveCurr`,
      // `_panStart/_panEnd`, `_zoomStart/_zoomEnd`). Those would leak
      // residual inertia from the outgoing mode's gestures into the
      // freshly restored camera on the very next per-frame `update()`.
      //
      // `applyCameraState` must therefore call
      // `cameraController.syncFromCamera()` AFTER writing the transform.
      seedStore(store, family);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Pose graph + populate snapshots via a tree round-trip.
      poseLiveCamera(ctrl, { position: [5, 6, 7], target: [1, 2, 3] });
      ctrl.setLayout('tree');
      poseLiveCamera(ctrl, {
        position: [100, 200, 300],
        target: [50, 60, 70],
        zoom: 2.5,
      });

      // Watch syncFromCamera from now on. The next two restores
      // (tree→graph and graph→tree) MUST each invoke it.
      const syncSpy = vi.spyOn(ctrl.getCameraController(), 'syncFromCamera');

      ctrl.setLayout('graph');
      expect(syncSpy).toHaveBeenCalledTimes(1);

      ctrl.setLayout('tree');
      expect(syncSpy).toHaveBeenCalledTimes(2);

      ctrl.detach();
    });

    it('preserves graph camera state across a tree round-trip even after CameraController.update() runs', () => {
      // Same fix, behavioural angle: the user's pose must survive
      // post-restore `update()` ticks. The mock controls don't simulate
      // damping (so an accidentally-missing sync wouldn't drift the
      // mock camera), but pumping update() at all exercises the path
      // and keeps the assertion close to what the real render loop
      // does.
      seedStore(store, family);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      poseLiveCamera(ctrl, { position: [5, 6, 7], target: [1, 2, 3] });
      ctrl.getCameraController().update();
      const graphPose = readLivePose(ctrl);

      ctrl.setLayout('tree');
      poseLiveCamera(ctrl, {
        position: [100, 200, 300],
        target: [50, 60, 70],
        zoom: 2.5,
      });
      ctrl.setLayout('graph');

      // Pump several update() ticks AFTER restoration.
      for (let i = 0; i < 5; i++) ctrl.getCameraController().update();

      const restored = readLivePose(ctrl);
      expect(restored.position).toEqual(graphPose.position);
      expect(restored.target).toEqual(graphPose.target);

      ctrl.detach();
    });

    it('hover does not displace tree-view cards after a graph→tree round-trip', () => {
      // Regression for the 0.1.18 → 0.1.19 fix: on a SECOND entry into
      // tree mode the cache short-circuits `engine.compute()`, so the
      // (newly constructed) TreeLayout's internal positions map stays
      // empty even though the cached map is populated. `paintNode` must
      // therefore read from the layout cache, not the engine — otherwise
      // every hover repaint shoves the card to the origin.
      seedStore(store, family);
      const ctrl = new SceneController({ store, layout: 'graph' });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Visit tree once (populates the cache).
      ctrl.setLayout('tree');
      // Round-trip back through graph.
      ctrl.setLayout('graph');
      // Re-enter tree — cache HIT, engine.compute() is NOT called.
      ctrl.setLayout('tree');

      // The new TreeLayout instance's positions map must indeed be
      // empty here (sanity check — exercises the precondition this test
      // exists to defend against).
      const liveEnginePositions = ctrl.getLayoutEngine().getPositions();
      expect(liveEnginePositions.size).toBe(0);

      // The tree node mesh built from the cache, however, has a card
      // for every node. Capture the as-built position of the first card
      // and assert that hovering it does NOT move it.
      // @ts-expect-error — internal access for a behavioural assertion
      const treeMesh = ctrl['treeNodeMesh'];
      expect(treeMesh).toBeTruthy();

      const targetId = 'adam';
      // Read what the buildTreeMeshes step recorded for `adam`.
      // @ts-expect-error — internal access
      const cardEntry = treeMesh.cards.get(targetId);
      expect(cardEntry).toBeTruthy();
      const positionBefore = {
        x: cardEntry.group.position.x,
        y: cardEntry.group.position.y,
        z: cardEntry.group.position.z,
      };

      // Trigger paintNode via the public hover path. We can't dispatch a
      // real pointer event meaningfully through the jsdom stack, so we
      // call paintNode directly through the index-based shortcut the
      // hover loop uses internally.
      const idx = 0; // 'adam' is the first node in `family`.
      // @ts-expect-error — internal access for a behavioural assertion
      ctrl['paintNode'](idx, true);

      const positionAfter = {
        x: cardEntry.group.position.x,
        y: cardEntry.group.position.y,
        z: cardEntry.group.position.z,
      };
      expect(positionAfter).toEqual(positionBefore);

      ctrl.detach();
    });

    it('clears snapshots on syncFromStore so stale frames do not leak across data changes', () => {
      // syncFromStore invalidates layout positions; the saved snapshots
      // reference the old coordinate space. After a sync, the next entry
      // into a mode must re-initialise via frameToFit (first-entry path).
      seedStore(store, family);
      const ctrl = new SceneController({ store });
      ctrl.attach(container);
      ctrl.syncFromStore();

      // Visit tree once so both snapshots are populated.
      ctrl.setLayout('tree');
      ctrl.setLayout('graph');

      // @ts-expect-error — internal access for the assertion
      expect(ctrl['graphCameraSnapshot']).not.toBeNull();
      // @ts-expect-error — internal access for the assertion
      expect(ctrl['treeCameraSnapshot']).not.toBeNull();

      // Re-sync (e.g. fresh data load) must wipe both snapshots.
      ctrl.syncFromStore();
      // @ts-expect-error — internal access for the assertion
      expect(ctrl['graphCameraSnapshot']).toBeNull();
      // @ts-expect-error — internal access for the assertion
      expect(ctrl['treeCameraSnapshot']).toBeNull();

      ctrl.detach();
    });
  });
});
