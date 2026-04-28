import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { SvgRenderer } from '../../src/renderer/SvgRenderer.js';
import { ForceLayout3D } from '../../src/layouts/ForceLayout3D.js';
import { TreeLayout } from '../../src/layouts/TreeLayout.js';
import type { GraphData } from '../../src/types.js';

const sample: GraphData = {
  nodes: [
    { id: 'abraham', attributes: { title: 'Abraham', type: 'person' } },
    { id: 'sarah', attributes: { title: 'Sarah', type: 'person' } },
    { id: 'isaac', attributes: { title: 'Isaac', type: 'person' } },
  ],
  edges: [
    {
      id: 'e1',
      sourceId: 'abraham',
      targetId: 'sarah',
      attributes: { type: 'married_to' },
    },
    {
      id: 'e2',
      sourceId: 'abraham',
      targetId: 'isaac',
      attributes: { type: 'father_of' },
    },
    {
      id: 'e3',
      sourceId: 'sarah',
      targetId: 'isaac',
      attributes: { type: 'mother_of' },
    },
  ],
};

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('SvgRenderer', () => {
  let store: GraphStore;
  let container: HTMLElement;

  beforeEach(() => {
    store = new GraphStore();
    document.body.innerHTML = '';
    container = makeContainer();
  });

  describe('attach / detach', () => {
    it('attaches an SVG element to the container', () => {
      const r = new SvgRenderer({ store });
      r.attach(container);
      expect(container.querySelector('svg.ig-svg')).not.toBeNull();
      r.detach();
    });

    it('attach is idempotent', () => {
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.attach(container);
      expect(container.querySelectorAll('svg.ig-svg').length).toBe(1);
      r.detach();
    });

    it('detach removes the SVG', () => {
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.detach();
      expect(container.querySelector('svg')).toBeNull();
    });

    it('detach is safe when never attached', () => {
      const r = new SvgRenderer({ store });
      expect(() => r.detach()).not.toThrow();
    });
  });

  describe('syncFromStore — node structure', () => {
    it('renders one ig-node group per node, each with glow + dot + label + tooltip', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();

      const nodes = container.querySelectorAll('g.ig-node');
      expect(nodes.length).toBe(3);

      nodes.forEach((g) => {
        // 1. glow halo (filled circle, opacity 0.1)
        expect(g.querySelector('circle.ig-node-glow')).not.toBeNull();
        // 2. solid dot
        expect(g.querySelector('circle.ig-node-dot')).not.toBeNull();
        // 3. label
        expect(g.querySelector('text.ig-node-label')).not.toBeNull();
        // 4. tooltip group
        expect(g.querySelector('g.ig-node-tooltip')).not.toBeNull();
      });

      r.detach();
    });

    it('glow halo has opacity 0.1 and an animate child', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();

      const glow = container.querySelector('circle.ig-node-glow') as SVGCircleElement;
      expect(glow.getAttribute('opacity')).toBe('0.1');
      expect(glow.querySelector('animate')).not.toBeNull();
      const anim = glow.querySelector('animate')!;
      expect(anim.getAttribute('attributeName')).toBe('r');
      expect(anim.getAttribute('repeatCount')).toBe('indefinite');

      r.detach();
    });

    it('dot has bobbing animate (cx or cy) with indefinite repeat', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();

      const dots = container.querySelectorAll('circle.ig-node-dot');
      dots.forEach((dot) => {
        const anim = dot.querySelector('animate');
        expect(anim).not.toBeNull();
        const axis = anim!.getAttribute('attributeName');
        expect(axis === 'cx' || axis === 'cy').toBe(true);
        expect(anim!.getAttribute('repeatCount')).toBe('indefinite');
      });

      r.detach();
    });

    it('label is plain text — no background, no border, fill zinc-400', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();

      const label = container.querySelector('text.ig-node-label') as SVGTextElement;
      expect(label.getAttribute('fill')).toBe('#a1a1aa');
      // It's a <text>, not a <rect>+<text>; sibling rects are NOT permitted.
      // Walk siblings and assert none is a rect with the label class.
      // (The tooltip rect is inside its own .ig-node-tooltip group — that's fine.)
      const node = label.parentElement!;
      const labelRect = node.querySelector(':scope > rect.ig-node-label-bg');
      expect(labelRect).toBeNull();

      r.detach();
    });

    it('tooltip group starts hidden (opacity 0) and contains a rect with the node color stroke', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();

      const tooltip = container.querySelector('g.ig-node-tooltip') as SVGGElement;
      expect(tooltip.getAttribute('opacity')).toBe('0');
      const rect = tooltip.querySelector('rect') as SVGRectElement;
      expect(rect).not.toBeNull();
      expect(rect.getAttribute('fill')).toBe('#1e1e2e');
      expect(rect.getAttribute('stroke-width')).toBe('0.5');
      // Stroke matches the node's resolved color — non-empty hex.
      expect(rect.getAttribute('stroke')).toMatch(/^#[0-9a-fA-F]{6}$/);

      r.detach();
    });

    it('tooltip text lines summarize relationships', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();

      const abraham = container.querySelector('g.ig-node[data-node-id="abraham"]') as SVGGElement;
      const lines = Array.from(abraham.querySelectorAll('g.ig-node-tooltip text')).map(
        (t) => t.textContent ?? '',
      );
      expect(lines).toContain('Abraham');
      // Type capitalized.
      expect(lines.some((l) => l === 'Person')).toBe(true);
      // Outgoing-edge summary mentions at least one rel type.
      const summary = lines.find(
        (l) => l.includes('father_of') || l.includes('married_to'),
      );
      expect(summary).toBeDefined();

      r.detach();
    });
  });

  describe('syncFromStore — edge structure', () => {
    it('renders one ig-edge group per edge, each with line + hitbox + label', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();

      const edges = container.querySelectorAll('g.ig-edge');
      expect(edges.length).toBe(3);

      edges.forEach((g) => {
        const visible = g.querySelector('line.ig-edge-line') as SVGLineElement;
        expect(visible).not.toBeNull();
        expect(visible.getAttribute('stroke-width')).toBe('1.5');

        const hitbox = g.querySelector('line.ig-edge-hitbox') as SVGLineElement;
        expect(hitbox).not.toBeNull();
        expect(hitbox.getAttribute('stroke')).toBe('transparent');
        expect(hitbox.getAttribute('stroke-width')).toBe('12');

        const label = g.querySelector('text.ig-edge-label') as SVGTextElement;
        expect(label).not.toBeNull();
        expect(label.getAttribute('opacity')).toBe('0');
        expect(label.getAttribute('fill')).toBe('#a1a1aa');
      });
    });

    it('edge line has an opacity animation with indefinite repeat', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();

      const visible = container.querySelector('line.ig-edge-line') as SVGLineElement;
      const anim = visible.querySelector('animate');
      expect(anim).not.toBeNull();
      expect(anim!.getAttribute('attributeName')).toBe('opacity');
      expect(anim!.getAttribute('repeatCount')).toBe('indefinite');

      r.detach();
    });

    it('edges are painted under nodes (edge group precedes node group)', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();

      const svg = container.querySelector('svg')!;
      const groups = svg.querySelectorAll(':scope > g');
      const edgeIdx = Array.from(groups).findIndex((g) =>
        g.classList.contains('ig-edges'),
      );
      const nodeIdx = Array.from(groups).findIndex((g) =>
        g.classList.contains('ig-nodes'),
      );
      expect(edgeIdx).toBeGreaterThanOrEqual(0);
      expect(nodeIdx).toBeGreaterThanOrEqual(0);
      expect(edgeIdx).toBeLessThan(nodeIdx);
    });
  });

  describe('color overrides', () => {
    it('uses nodeColors override for nodes', () => {
      store.loadData(sample);
      const r = new SvgRenderer({
        store,
        nodeColors: { person: '#ff00ff' },
      });
      r.attach(container);
      r.syncFromStore();

      const dot = container.querySelector('circle.ig-node-dot') as SVGCircleElement;
      expect(dot.getAttribute('fill')).toBe('#ff00ff');

      r.detach();
    });

    it('uses edgeColors override for edges', () => {
      store.loadData(sample);
      const r = new SvgRenderer({
        store,
        edgeColors: { father_of: '#abcdef' },
      });
      r.attach(container);
      r.syncFromStore();

      const fatherEdge = container.querySelector(
        'g.ig-edge[data-edge-type="father_of"] line.ig-edge-line',
      ) as SVGLineElement;
      expect(fatherEdge).not.toBeNull();
      expect(fatherEdge.getAttribute('stroke')).toBe('#abcdef');

      r.detach();
    });

    it('uses nodeColorFn over nodeColors', () => {
      store.loadData(sample);
      const r = new SvgRenderer({
        store,
        nodeColors: { person: '#ff00ff' },
        nodeColorFn: () => '#123456',
      });
      r.attach(container);
      r.syncFromStore();

      const dot = container.querySelector('circle.ig-node-dot') as SVGCircleElement;
      expect(dot.getAttribute('fill')).toBe('#123456');

      r.detach();
    });
  });

  describe('layout switching', () => {
    it('starts in graph mode by default', () => {
      const r = new SvgRenderer({ store });
      expect(r.getLayoutMode()).toBe('graph');
      expect(r.getLayoutEngine()).toBeInstanceOf(ForceLayout3D);
    });

    it('honors an explicit tree layout', () => {
      const r = new SvgRenderer({ store, layout: 'tree' });
      expect(r.getLayoutMode()).toBe('tree');
      expect(r.getLayoutEngine()).toBeInstanceOf(TreeLayout);
    });

    it('setLayout swaps the engine and re-renders', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();

      r.setLayout('tree');
      expect(r.getLayoutMode()).toBe('tree');
      expect(r.getLayoutEngine()).toBeInstanceOf(TreeLayout);
      // Should still have rendered nodes after the layout switch.
      expect(container.querySelectorAll('g.ig-node').length).toBe(3);

      r.detach();
    });

    it('setLayout to current mode is a no-op', () => {
      const r = new SvgRenderer({ store, layout: 'graph' });
      const before = r.getLayoutEngine();
      r.setLayout('graph');
      expect(r.getLayoutEngine()).toBe(before);
    });
  });

  describe('showLabels', () => {
    it('omits labels when showLabels=false', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store, showLabels: false });
      r.attach(container);
      r.syncFromStore();

      expect(container.querySelectorAll('text.ig-node-label').length).toBe(0);
      r.detach();
    });

    it('setShowLabels toggles labels at runtime', () => {
      store.loadData(sample);
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();
      expect(container.querySelectorAll('text.ig-node-label').length).toBe(3);

      r.setShowLabels(false);
      expect(container.querySelectorAll('text.ig-node-label').length).toBe(0);

      r.setShowLabels(true);
      expect(container.querySelectorAll('text.ig-node-label').length).toBe(3);

      r.detach();
    });
  });

  describe('resize', () => {
    it('is a safe no-op (SVG is intrinsically responsive)', () => {
      const r = new SvgRenderer({ store });
      r.attach(container);
      expect(() => r.resize()).not.toThrow();
      r.detach();
    });
  });

  describe('empty store', () => {
    it('attach + sync renders no nodes and no edges, but the SVG mounts', () => {
      const r = new SvgRenderer({ store });
      r.attach(container);
      r.syncFromStore();
      expect(container.querySelector('svg.ig-svg')).not.toBeNull();
      expect(container.querySelectorAll('g.ig-node').length).toBe(0);
      expect(container.querySelectorAll('g.ig-edge').length).toBe(0);
      r.detach();
    });
  });

  describe('hover via inline CSS', () => {
    it('attaches an inline <style> block with hover rules', () => {
      const r = new SvgRenderer({ store });
      r.attach(container);
      const style = container.querySelector('svg style') as SVGStyleElement;
      expect(style).not.toBeNull();
      const css = style.textContent ?? '';
      expect(css).toContain('.ig-node:hover');
      expect(css).toContain('.ig-edge:hover');
      r.detach();
    });
  });
});
