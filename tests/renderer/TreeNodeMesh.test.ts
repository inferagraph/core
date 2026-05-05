import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock three.js with the surface area TreeNodeMesh actually touches:
// Group, Shape, ShapeGeometry, BufferGeometry (with setFromPoints),
// Mesh, LineLoop, MeshBasicMaterial, LineBasicMaterial, Vector3.
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
    return this;
  });
  return {
    Vector3,
    Group: vi.fn().mockImplementation(() => {
      const children: unknown[] = [];
      return {
        name: '',
        userData: {} as Record<string, unknown>,
        position: {
          x: 0,
          y: 0,
          z: 0,
          set: vi.fn().mockImplementation(function (
            this: { x: number; y: number; z: number },
            x: number,
            y: number,
            z: number,
          ) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
          }),
        },
        children,
        add: vi.fn().mockImplementation((c: unknown) => {
          children.push(c);
        }),
        remove: vi.fn(),
      };
    }),
    Shape: vi.fn().mockImplementation(function (this: object) {
      Object.assign(this, {
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        // 24 sample points — enough to satisfy callers like TreeNodeMesh that
        // turn the shape into an outline buffer.
        getPoints: vi.fn().mockReturnValue(
          Array.from({ length: 24 }, (_, i) => ({ x: Math.cos(i), y: Math.sin(i) })),
        ),
      });
      return this;
    }),
    ShapeGeometry: vi.fn().mockImplementation(() => ({
      dispose: vi.fn(),
    })),
    BufferGeometry: vi.fn().mockImplementation(function (this: object) {
      const attributes: Record<string, unknown> = {};
      Object.assign(this, {
        attributes,
        setAttribute: vi.fn().mockImplementation((name: string, attr: unknown) => {
          attributes[name] = attr;
        }),
        getAttribute: vi.fn().mockImplementation((name: string) => attributes[name]),
        setDrawRange: vi.fn(),
        dispose: vi.fn(),
        setFromPoints: vi.fn().mockReturnThis(),
      });
      return this;
    }),
    Float32BufferAttribute: vi.fn().mockImplementation((arr: Float32Array, size: number) => ({
      array: arr,
      itemSize: size,
      needsUpdate: false,
    })),
    Mesh: vi.fn().mockImplementation((geo, mat) => ({
      geometry: geo,
      material: mat,
      renderOrder: 0,
      type: 'Mesh',
      position: { x: 0, y: 0, z: 0, set: vi.fn() },
    })),
    LineLoop: vi.fn().mockImplementation((geo, mat) => ({
      geometry: geo,
      material: mat,
      renderOrder: 0,
      type: 'LineLoop',
    })),
    MeshBasicMaterial: vi.fn().mockImplementation((opts: Record<string, unknown> = {}) => ({
      dispose: vi.fn(),
      color: {
        value: opts.color ?? null,
        set: vi.fn().mockImplementation(function (this: { value: unknown }, v: unknown) {
          this.value = v;
          return this;
        }),
      },
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      depthWrite: opts.depthWrite ?? true,
      side: opts.side,
      map: opts.map ?? null,
    })),
    LineBasicMaterial: vi.fn().mockImplementation((opts: Record<string, unknown> = {}) => ({
      dispose: vi.fn(),
      color: {
        value: opts.color ?? null,
        set: vi.fn().mockImplementation(function (this: { value: unknown }, v: unknown) {
          this.value = v;
          return this;
        }),
      },
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
    })),
    PlaneGeometry: vi.fn().mockImplementation((width: number, height: number) => ({
      type: 'PlaneGeometry',
      parameters: { width, height },
      dispose: vi.fn(),
    })),
    CanvasTexture: vi.fn().mockImplementation((canvas: unknown) => ({
      type: 'CanvasTexture',
      image: canvas,
      needsUpdate: false,
      anisotropy: 1,
      dispose: vi.fn(),
    })),
    DoubleSide: 2,
  };
});

import { TreeNodeMesh } from '../../src/renderer/TreeNodeMesh.js';

interface CardEntry {
  id: string;
  position: { x: number; y: number; z: number };
  color: string;
}

const sampleEntries: CardEntry[] = [
  { id: 'adam', position: { x: 0, y: 100, z: 0 }, color: '#ff0000' },
  { id: 'eve', position: { x: 50, y: 100, z: 0 }, color: '#00ff00' },
  { id: 'cain', position: { x: 25, y: 0, z: 0 }, color: '#0000ff' },
];

describe('TreeNodeMesh', () => {
  let mesh: TreeNodeMesh;
  let getContextSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    mesh = new TreeNodeMesh();
    // jsdom's `<canvas>` returns `null` from `getContext('2d')` (no canvas
    // backend bundled). Stub it with a no-op 2D context so the label-plane
    // path actually executes.
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(((type: string) => {
        if (type !== '2d') return null;
        return {
          clearRect: vi.fn(),
          fillText: vi.fn(),
          measureText: vi.fn().mockReturnValue({ width: 50 }),
          font: '',
          textAlign: '',
          textBaseline: '',
          fillStyle: '',
        } as unknown as CanvasRenderingContext2D;
      }) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  });

  afterEach(() => {
    getContextSpy?.mockRestore();
    getContextSpy = null;
  });

  describe('build', () => {
    it('produces a root Group containing one card per entry', () => {
      mesh.build(sampleEntries);
      const root = mesh.getMesh();
      expect(root).not.toBeNull();
      // Each entry contributes one card group as a child of the root.
      expect((root as { children: unknown[] }).children.length).toBe(sampleEntries.length);
    });

    it('stamps userData.nodeId on each card group so the raycaster can resolve hits', () => {
      mesh.build(sampleEntries);
      const targets = mesh.getRaycastTargets();
      expect(targets.length).toBe(sampleEntries.length);
      const ids = targets.map((t) => (t as { userData: { nodeId: string } }).userData.nodeId);
      expect(ids).toEqual(['adam', 'eve', 'cain']);
    });

    it('positions each card group at the supplied entry position', () => {
      mesh.build(sampleEntries);
      const targets = mesh.getRaycastTargets();
      expect((targets[0] as { position: { x: number; y: number; z: number } }).position).toMatchObject({
        x: 0,
        y: 100,
        z: 0,
      });
      expect((targets[2] as { position: { x: number; y: number; z: number } }).position).toMatchObject({
        x: 25,
        y: 0,
        z: 0,
      });
    });

    it('builds each card with a translucent dark fill mesh + outline line', () => {
      mesh.build(sampleEntries);
      const targets = mesh.getRaycastTargets();
      const card = targets[0] as { children: Array<{ type: string; material: { transparent?: boolean; opacity?: number } }> };
      expect(card.children.length).toBe(2);
      const fill = card.children.find((c) => c.type === 'Mesh');
      const outline = card.children.find((c) => c.type === 'LineLoop');
      expect(fill).toBeDefined();
      expect(outline).toBeDefined();
      // Fill is translucent so the dark card recedes against any background.
      expect(fill?.material.transparent).toBe(true);
      expect(fill?.material.opacity).toBeCloseTo(0.8, 5);
    });

    it('rebuilding disposes the prior cards and replaces them', () => {
      mesh.build(sampleEntries.slice(0, 2));
      const firstRoot = mesh.getMesh();
      mesh.build(sampleEntries);
      const secondRoot = mesh.getMesh();
      expect(secondRoot).not.toBe(firstRoot);
      expect((secondRoot as { children: unknown[] }).children.length).toBe(sampleEntries.length);
    });
  });

  describe('updateCard', () => {
    it('moves an existing card to the supplied position', () => {
      mesh.build(sampleEntries);
      mesh.updateCard('cain', { x: 999, y: -1, z: 5 });
      const targets = mesh.getRaycastTargets();
      const cain = targets.find((t) => (t as { userData: { nodeId: string } }).userData.nodeId === 'cain');
      expect((cain as { position: { x: number; y: number; z: number } }).position).toMatchObject({
        x: 999,
        y: -1,
        z: 5,
      });
    });

    it('updates the outline color when a color is supplied', () => {
      mesh.build(sampleEntries);
      mesh.updateCard('adam', { x: 0, y: 0, z: 0 }, '#abcdef');
      const targets = mesh.getRaycastTargets();
      const adam = targets[0] as { children: Array<{ type: string; material: { color: { value?: string } } }> };
      const outline = adam.children.find((c) => c.type === 'LineLoop');
      expect(outline?.material.color.value).toBe('#abcdef');
    });

    it('is a no-op for unknown ids', () => {
      mesh.build(sampleEntries);
      expect(() => mesh.updateCard('nobody', { x: 1, y: 2, z: 3 })).not.toThrow();
    });
  });

  describe('getCardSize', () => {
    it('returns the configured card geometry so consumers can route connectors', () => {
      const m = new TreeNodeMesh({ width: 120, height: 40 });
      expect(m.getCardSize()).toEqual({ width: 120, height: 40 });
    });

    it('falls back to the static defaults when no overrides are supplied', () => {
      expect(mesh.getCardSize()).toEqual({
        width: TreeNodeMesh.DEFAULT_WIDTH,
        height: TreeNodeMesh.DEFAULT_HEIGHT,
      });
    });
  });

  describe('label rendering', () => {
    // 0.1.16: tree-mode card text is rasterised inside the WebGL card via
    // a CanvasTexture-backed plane. The HTML LabelRenderer overlay is
    // intentionally not used in tree mode, so the card itself owns the
    // text. These tests guard the structural shape of the resulting mesh
    // group.
    it('adds a third child plane carrying a CanvasTexture when label is supplied', () => {
      mesh.build([
        { id: 'adam', position: { x: 0, y: 0, z: 0 }, color: '#fff', label: 'Adam' },
      ]);
      const targets = mesh.getRaycastTargets();
      const card = targets[0] as {
        children: Array<{
          type?: string;
          geometry?: { type?: string };
          material?: { map?: { type?: string } };
        }>;
      };
      // fill mesh + outline LineLoop + label plane = 3 children.
      expect(card.children.length).toBe(3);
      const labelMesh = card.children.find(
        (c) => c.geometry?.type === 'PlaneGeometry',
      );
      expect(labelMesh).toBeDefined();
      // The label plane's material must carry a CanvasTexture in `.map`.
      expect(labelMesh?.material?.map?.type).toBe('CanvasTexture');
    });

    it('omits the label plane when no label is supplied (back-compat)', () => {
      mesh.build([
        { id: 'adam', position: { x: 0, y: 0, z: 0 }, color: '#fff' },
      ]);
      const targets = mesh.getRaycastTargets();
      const card = targets[0] as { children: Array<{ geometry?: { type?: string } }> };
      // Only fill + outline; no label plane.
      expect(card.children.length).toBe(2);
      expect(
        card.children.some((c) => c.geometry?.type === 'PlaneGeometry'),
      ).toBe(false);
    });

    it('label font is no more than 30% of card height (so long names like Methuselah fit)', () => {
      // Capture the `ctx.font` string rather than the canvas pixel size.
      // The font is "{weight} {sizePx}px {family}", and `sizePx` is in
      // *canvas pixels*, which is `cardHeight * LABEL_PIXELS_PER_UNIT`.
      // Therefore the ratio of fontPx to canvas height equals the
      // designer-facing ratio of font height to card height.
      const captured: { font?: string } = {};
      getContextSpy?.mockRestore();
      getContextSpy = vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation(((type: string) => {
          if (type !== '2d') return null;
          const ctx = {
            clearRect: vi.fn(),
            fillText: vi.fn(),
            measureText: vi.fn().mockReturnValue({ width: 50 }),
            // Stash the most-recently-assigned `font` so the test can
            // inspect it after `build`.
            set font(value: string) {
              captured.font = value;
            },
            get font() {
              return captured.font ?? '';
            },
            textAlign: '',
            textBaseline: '',
            fillStyle: '',
          } as unknown as CanvasRenderingContext2D;
          return ctx;
        }) as unknown as typeof HTMLCanvasElement.prototype.getContext);

      const cardHeight = TreeNodeMesh.DEFAULT_HEIGHT;
      const ppu = TreeNodeMesh.LABEL_PIXELS_PER_UNIT;
      const canvasH = Math.round(cardHeight * ppu);

      mesh.build([
        { id: 'methuselah', position: { x: 0, y: 0, z: 0 }, color: '#fff', label: 'Methuselah' },
      ]);

      expect(captured.font).toBeDefined();
      const match = captured.font!.match(/(\d+(?:\.\d+)?)px/);
      expect(match).not.toBeNull();
      const fontPx = Number(match![1]);
      const ratio = fontPx / canvasH;
      // ≥ ~20% so the text is still legible at typical zoom.
      expect(ratio).toBeGreaterThanOrEqual(0.2);
      // ≤ 30% so longer biblical names fit comfortably inside the card.
      expect(ratio).toBeLessThanOrEqual(0.3);
    });

    it('omits the label plane gracefully when 2D canvas context is unavailable', () => {
      // Restore the stub so getContext returns null again — mirrors a
      // pure SSR / Node-without-jsdom environment.
      getContextSpy?.mockRestore();
      vi
        .spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(null as unknown as CanvasRenderingContext2D);

      mesh.build([
        { id: 'adam', position: { x: 0, y: 0, z: 0 }, color: '#fff', label: 'Adam' },
      ]);
      const targets = mesh.getRaycastTargets();
      const card = targets[0] as { children: Array<{ geometry?: { type?: string } }> };
      expect(card.children.length).toBe(2);
    });
  });

  describe('setVisibility', () => {
    it('flips group.visible per card based on the predicate set', () => {
      mesh.build(sampleEntries);
      mesh.setVisibility(new Set(['adam', 'cain'])); // hide eve

      const targets = mesh.getRaycastTargets() as Array<{
        userData: { nodeId: string };
        visible?: boolean;
      }>;
      const byId = new Map(targets.map((t) => [t.userData.nodeId, t.visible]));
      expect(byId.get('adam')).toBe(true);
      expect(byId.get('eve')).toBe(false);
      expect(byId.get('cain')).toBe(true);
    });

    it('clearing the predicate restores all cards', () => {
      mesh.build(sampleEntries);
      mesh.setVisibility(new Set()); // hide everyone
      mesh.setVisibility(new Set(['adam', 'eve', 'cain'])); // restore everyone

      const targets = mesh.getRaycastTargets() as Array<{
        userData: { nodeId: string };
        visible?: boolean;
      }>;
      for (const t of targets) {
        expect(t.visible).toBe(true);
      }
    });

    it('is a no-op before build', () => {
      expect(() => mesh.setVisibility(new Set(['adam']))).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('clears the root and disposes geometry/materials', () => {
      mesh.build(sampleEntries);
      mesh.dispose();
      expect(mesh.getMesh()).toBeNull();
      expect(mesh.getRaycastTargets()).toEqual([]);
    });

    it('is safe to call repeatedly', () => {
      mesh.build(sampleEntries);
      mesh.dispose();
      expect(() => mesh.dispose()).not.toThrow();
    });

    it('is safe to call before build', () => {
      expect(() => mesh.dispose()).not.toThrow();
    });
  });
});
