import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportEngine } from '../../src/export/ExportEngine.js';
import { GraphStore } from '../../src/store/GraphStore.js';

function createTestStore(): GraphStore {
  const store = new GraphStore();
  store.loadData({
    nodes: [
      { id: 'n1', attributes: { name: 'Adam', type: 'person' } },
      { id: 'n2', attributes: { name: 'Eve', type: 'person' } },
      { id: 'n3', attributes: { name: 'Eden', type: 'place' } },
    ],
    edges: [
      { id: 'e1', sourceId: 'n1', targetId: 'n2', attributes: { type: 'husband_of' } },
      { id: 'e2', sourceId: 'n1', targetId: 'n3', attributes: { type: 'lives_in' } },
    ],
  });
  return store;
}

// Mock canvas context for jsdom
const mockCtx = {
  scale: vi.fn(),
  drawImage: vi.fn(),
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ExportEngine', () => {
  describe('exportJSON()', () => {
    it('should export full graph as JSON', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);
      const json = engine.exportJSON();
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe(1);
      expect(parsed.nodes).toHaveLength(3);
      expect(parsed.edges).toHaveLength(2);
      expect(parsed.metadata).toBeDefined();
    });

    it('should export selected nodes only', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);
      const json = engine.exportJSON({
        selectedOnly: true,
        selectedNodeIds: new Set(['n1', 'n2']),
      });
      const parsed = JSON.parse(json);

      expect(parsed.nodes).toHaveLength(2);
      expect(parsed.edges).toHaveLength(1); // only e1 (both endpoints selected)
    });

    it('should exclude metadata when includeMetadata is false', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);
      const json = engine.exportJSON({ includeMetadata: false });
      const parsed = JSON.parse(json);

      expect(parsed.metadata).toBeUndefined();
    });

    it('should round-trip via GraphStore.fromJSON', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);
      const json = engine.exportJSON();

      const store2 = new GraphStore();
      store2.fromJSON(JSON.parse(json));

      expect(store2.nodeCount).toBe(3);
      expect(store2.edgeCount).toBe(2);
    });

    it('should handle empty graph', () => {
      const store = new GraphStore();
      const engine = new ExportEngine(store);
      const json = engine.exportJSON();
      const parsed = JSON.parse(json);

      expect(parsed.nodes).toHaveLength(0);
      expect(parsed.edges).toHaveLength(0);
    });
  });

  describe('exportSVG()', () => {
    it('should generate valid SVG with nodes and edges', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);

      const nodes = [
        { id: 'n1', x: 100, y: 100, label: 'Adam', color: '#ff0000' },
        { id: 'n2', x: 200, y: 200, label: 'Eve' },
      ];
      const edges = [
        { sourceX: 100, sourceY: 100, targetX: 200, targetY: 200 },
      ];

      const svg = engine.exportSVG(nodes, edges);

      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('circle');
      expect(svg).toContain('line');
      expect(svg).toContain('Adam');
      expect(svg).toContain('Eve');
    });

    it('should use default dimensions', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);
      const svg = engine.exportSVG([], []);

      expect(svg).toContain('width="800"');
      expect(svg).toContain('height="600"');
    });

    it('should use custom dimensions', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);
      const svg = engine.exportSVG([], [], { width: 1024, height: 768 });

      expect(svg).toContain('width="1024"');
      expect(svg).toContain('height="768"');
    });

    it('should have correct node count in SVG', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);
      const nodes = [
        { id: 'n1', x: 10, y: 10 },
        { id: 'n2', x: 20, y: 20 },
        { id: 'n3', x: 30, y: 30 },
      ];
      const svg = engine.exportSVG(nodes, []);

      const circleCount = (svg.match(/<circle/g) || []).length;
      expect(circleCount).toBe(3);
    });

    it('should escape XML entities in labels', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);
      const nodes = [{ id: 'n1', x: 10, y: 10, label: 'A & B <test>' }];
      const svg = engine.exportSVG(nodes, []);

      expect(svg).toContain('A &amp; B &lt;test&gt;');
      expect(svg).not.toContain('A & B <test>');
    });
  });

  describe('exportPNG()', () => {
    it('should call toDataURL on canvas', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);

      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 300;
      canvas.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,abc');

      const result = engine.exportPNG(canvas);
      expect(result).toBe('data:image/png;base64,abc');
      expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
    });

    it('should handle scale option', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);

      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 300;

      // Mock getContext for the scaled canvas
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as any;
      HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,scaled') as any;

      const result = engine.exportPNG(canvas, { scale: 2 });
      expect(result).toContain('data:image/png');
    });
  });

  describe('exportPNGBlob()', () => {
    it('should return a blob', async () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);

      const blob = new Blob(['test'], { type: 'image/png' });
      const canvas = document.createElement('canvas');
      canvas.toBlob = vi.fn((cb) => cb(blob)) as any;

      const result = await engine.exportPNGBlob(canvas);
      expect(result).toBe(blob);
    });

    it('should reject if blob creation fails', async () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);

      const canvas = document.createElement('canvas');
      canvas.toBlob = vi.fn((cb) => cb(null)) as any;

      await expect(engine.exportPNGBlob(canvas)).rejects.toThrow('Failed to create PNG blob');
    });
  });

  describe('download()', () => {
    it('should create and click a download link', () => {
      const store = createTestStore();
      const engine = new ExportEngine(store);

      const clickSpy = vi.fn();
      vi.spyOn(document, 'createElement').mockReturnValue({
        set href(v: string) {},
        set download(v: string) {},
        click: clickSpy,
      } as any);

      // Mock URL methods
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
      URL.revokeObjectURL = vi.fn();

      engine.download('<svg></svg>', 'graph.svg', 'image/svg+xml');

      expect(clickSpy).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalled();

      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    });
  });
});
