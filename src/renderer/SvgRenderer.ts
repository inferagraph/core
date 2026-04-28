import type {
  EdgeData,
  LayoutMode,
  NodeData,
  NodeRenderConfig,
  TooltipConfig,
  Vector3,
} from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';
import { LayoutEngine } from '../layouts/LayoutEngine.js';
import { ForceLayout3D } from '../layouts/ForceLayout3D.js';
import { TreeLayout } from '../layouts/TreeLayout.js';
import {
  NodeColorResolver,
  type NodeColorFn,
  type NodeColorResolverOptions,
} from './NodeColorResolver.js';
import {
  EdgeColorMap,
  type EdgeColorFn,
  type EdgeColorMapOptions,
} from './EdgeColorMap.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SvgRendererOptions {
  /** Source-of-truth graph data store. */
  store: GraphStore;
  /** Layout mode at construction time. Default `'graph'`. */
  layout?: LayoutMode;
  /** Node-render config. The SVG renderer ignores `style`/`component` but
   *  retains the field for API parity with the WebGL path. */
  nodeRender?: NodeRenderConfig;
  /** Tooltip config — currently only used to allow consumers to disable. */
  tooltip?: TooltipConfig;
  /** Toggle the per-node label. Default `true`. */
  showLabels?: boolean;

  // Color resolution
  /** Pool of colors for auto-assignment. */
  palette?: readonly string[];
  /** Explicit type → color map for nodes. */
  nodeColors?: Record<string, string>;
  /** Function override for nodes. */
  nodeColorFn?: NodeColorFn;
  /** Explicit type → color map for edges. */
  edgeColors?: Record<string, string>;
  /** Function override for edges. */
  edgeColorFn?: EdgeColorFn;
}

interface PreparedNode {
  id: string;
  data: NodeData;
  x: number;
  y: number;
  color: string;
  /** Glow halo radius. */
  rGlow: number;
  /** Glow halo expanded radius (animation peak). */
  rGlowExpanded: number;
  /** Solid dot radius. */
  rDot: number;
  /** Animation duration for the glow halo, seconds. */
  glowDur: number;
  /** Animation duration for the dot bobble, seconds. */
  bobDur: number;
  /** Whether the bob is on cy (true) or cx (false). */
  bobAxis: 'cx' | 'cy';
  /** Bob amplitude in viewBox units. */
  bobAmp: number;
}

interface PreparedEdge {
  id: string;
  data: EdgeData;
  sourceId: string;
  targetId: string;
  color: string;
  dur: number;
  opLow: number;
  opHigh: number;
}

/**
 * Pure-SVG renderer that mirrors the marketing-mockup look pixel-for-pixel.
 *
 * Per node, five layered elements are emitted:
 *   1. glow halo (large, transparent fill, animated radius)
 *   2. solid dot (small, bobs subtly)
 *   3. label (zinc-400 text positioned next to the node)
 *   4. hover tooltip (rounded rect + text lines, opacity 0 by default)
 *   5. cursor: pointer on the parent group
 *
 * Per edge, three layered elements:
 *   1. visible colored line (animated opacity)
 *   2. transparent hitbox (12 px wide for easy hover)
 *   3. hover label (relationship type, opacity 0 by default)
 *
 * Hover behavior is driven entirely by inline CSS — no JS event listeners.
 */
export class SvgRenderer {
  private readonly store: GraphStore;
  private container: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  private edgesGroup: SVGGElement | null = null;
  private nodesGroup: SVGGElement | null = null;

  private layoutMode: LayoutMode;
  private layoutEngine: LayoutEngine;

  private nodeRender: NodeRenderConfig | undefined;
  private tooltip: TooltipConfig | undefined;
  private showLabels: boolean;

  private readonly nodeColorResolver: NodeColorResolver;
  private readonly edgeColorMap: EdgeColorMap;

  /** Cached prepared nodes / edges from the last sync — for tests + tooltip wiring. */
  private preparedNodes: PreparedNode[] = [];
  private preparedEdges: PreparedEdge[] = [];

  constructor(options: SvgRendererOptions) {
    this.store = options.store;
    this.layoutMode = options.layout ?? 'graph';
    this.layoutEngine = SvgRenderer.createLayoutEngine(this.layoutMode);
    this.nodeRender = options.nodeRender;
    this.tooltip = options.tooltip;
    this.showLabels = options.showLabels ?? true;

    const nodeColorOptions: NodeColorResolverOptions = {
      palette: options.palette,
      nodeColors: options.nodeColors,
      colorFn: options.nodeColorFn,
    };
    const edgeColorOptions: EdgeColorMapOptions = {
      palette: options.palette,
      edgeColors: options.edgeColors,
      colorFn: options.edgeColorFn,
    };
    this.nodeColorResolver = new NodeColorResolver(nodeColorOptions);
    this.edgeColorMap = new EdgeColorMap(edgeColorOptions);
  }

  /** Mount the SVG into `container`. Idempotent. */
  attach(container: HTMLElement): void {
    if (this.container) return;
    this.container = container;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ig-svg');
    svg.setAttribute('viewBox', '0 0 400 400');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.display = 'block';

    // Inline style block — keeps hover behavior native, no JS required.
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = SvgRenderer.STYLE_CSS;
    svg.appendChild(style);

    // Edge layer first (so nodes render on top).
    const edges = document.createElementNS(SVG_NS, 'g');
    edges.setAttribute('class', 'ig-edges');
    svg.appendChild(edges);

    const nodes = document.createElementNS(SVG_NS, 'g');
    nodes.setAttribute('class', 'ig-nodes');
    svg.appendChild(nodes);

    container.appendChild(svg);

    this.svg = svg;
    this.edgesGroup = edges;
    this.nodesGroup = nodes;
  }

  /** Tear down the SVG. Safe to call multiple times. */
  detach(): void {
    if (!this.container || !this.svg) {
      this.container = null;
      this.svg = null;
      this.edgesGroup = null;
      this.nodesGroup = null;
      return;
    }
    this.svg.remove();
    this.svg = null;
    this.edgesGroup = null;
    this.nodesGroup = null;
    this.container = null;
    this.preparedNodes = [];
    this.preparedEdges = [];
  }

  /** Read all nodes + edges from the store, run layout, render. Idempotent. */
  syncFromStore(): void {
    if (!this.svg || !this.edgesGroup || !this.nodesGroup) return;

    const nodes = this.store.getAllNodes();
    const edges = this.store.getAllEdges();

    const nodeIds = nodes.map((n) => n.id);
    const edgeEndpoints = edges.map((e) => ({
      sourceId: e.sourceId,
      targetId: e.targetId,
    }));

    const positions =
      nodeIds.length > 0
        ? this.layoutEngine.compute(nodeIds, edgeEndpoints)
        : new Map<string, Vector3>();

    // Project the (possibly 3D) layout positions into the SVG viewBox by
    // dropping z and centering inside [0..400] with margin.
    const projected = SvgRenderer.projectToViewBox(positions, 400, 400, 32);

    // Clear previous content.
    while (this.edgesGroup.firstChild) this.edgesGroup.removeChild(this.edgesGroup.firstChild);
    while (this.nodesGroup.firstChild) this.nodesGroup.removeChild(this.nodesGroup.firstChild);

    // Build neighbor map for tooltip text.
    const outgoing = new Map<string, EdgeData[]>();
    const incoming = new Map<string, EdgeData[]>();
    edges.forEach((e) => {
      const eData: EdgeData = {
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        attributes: e.attributes,
      };
      const o = outgoing.get(e.sourceId) ?? [];
      o.push(eData);
      outgoing.set(e.sourceId, o);
      const i = incoming.get(e.targetId) ?? [];
      i.push(eData);
      incoming.set(e.targetId, i);
    });

    // Prepare edges first so we can paint them under the nodes.
    this.preparedEdges = edges.map((e, idx) => {
      const data: EdgeData = {
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        attributes: e.attributes,
      };
      const color = this.edgeColorMap.resolve(data);
      // Stagger durations a little so the canvas isn't perfectly synchronized.
      const dur = 3.5 + ((idx * 0.5) % 3); // 3.5..6 s
      return {
        id: e.id,
        data,
        sourceId: e.sourceId,
        targetId: e.targetId,
        color,
        dur,
        opLow: 0.2,
        opHigh: 0.5,
      };
    });

    this.preparedEdges.forEach((edge) => {
      const sp = projected.get(edge.sourceId);
      const tp = projected.get(edge.targetId);
      if (!sp || !tp) return;
      this.edgesGroup!.appendChild(this.buildEdgeElement(edge, sp, tp));
    });

    // Prepare and render nodes.
    this.preparedNodes = nodes.map((n, idx) => {
      const data: NodeData = { id: n.id, attributes: n.attributes };
      const color = this.nodeColorResolver.resolve(data);
      const p = projected.get(n.id) ?? { x: 200, y: 200 };
      // Vary the visual sizes a little so the canvas feels organic.
      const rGlow = 14 + (idx % 4) * 2; // 14..20
      const rGlowExpanded = rGlow + 8;
      const rDot = 5 + (idx % 4); // 5..8
      const glowDur = 4 + ((idx * 0.5) % 2); // 4..5.5 s
      const bobDur = 5 + ((idx * 0.7) % 2); // 5..7 s
      const bobAxis: 'cx' | 'cy' = idx % 2 === 0 ? 'cy' : 'cx';
      const bobAmp = 6;
      return {
        id: n.id,
        data,
        x: p.x,
        y: p.y,
        color,
        rGlow,
        rGlowExpanded,
        rDot,
        glowDur,
        bobDur,
        bobAxis,
        bobAmp,
      };
    });

    this.preparedNodes.forEach((node) => {
      const out = outgoing.get(node.id) ?? [];
      const inc = incoming.get(node.id) ?? [];
      this.nodesGroup!.appendChild(this.buildNodeElement(node, out, inc));
    });
  }

  /** Switch layout mode at runtime. Re-runs layout + re-renders. */
  setLayout(mode: LayoutMode): void {
    if (mode === this.layoutMode) return;
    this.layoutMode = mode;
    this.layoutEngine = SvgRenderer.createLayoutEngine(mode);
    if (this.svg) this.syncFromStore();
  }

  /** Replace the NodeRenderConfig (kept for API parity). */
  setNodeRender(config: NodeRenderConfig | undefined): void {
    this.nodeRender = config;
    // SVG renderer doesn't customize per-render right now; resync if attached.
    if (this.svg) this.syncFromStore();
  }

  /** Replace the TooltipConfig (kept for API parity). */
  setTooltip(config: TooltipConfig | undefined): void {
    this.tooltip = config;
  }

  /** Toggle visible labels at runtime. */
  setShowLabels(show: boolean): void {
    if (this.showLabels === show) return;
    this.showLabels = show;
    if (this.svg) this.syncFromStore();
  }

  /** No-op: SVG is intrinsically responsive via viewBox. */
  resize(): void {
    // Intentionally empty.
  }

  /** Active layout engine (for tests + advanced consumers). */
  getLayoutEngine(): LayoutEngine {
    return this.layoutEngine;
  }

  /** Active layout mode. */
  getLayoutMode(): LayoutMode {
    return this.layoutMode;
  }

  /** Active node render config (for tests). */
  getNodeRender(): NodeRenderConfig | undefined {
    return this.nodeRender;
  }

  /** Active tooltip config (for tests). */
  getTooltip(): TooltipConfig | undefined {
    return this.tooltip;
  }

  /** Mounted SVG element (for tests). */
  getSvg(): SVGSVGElement | null {
    return this.svg;
  }

  /** Color resolver (for tests + introspection). */
  getNodeColorResolver(): NodeColorResolver {
    return this.nodeColorResolver;
  }

  /** Edge color map (for tests + introspection). */
  getEdgeColorMap(): EdgeColorMap {
    return this.edgeColorMap;
  }

  // --- internals ---

  private buildEdgeElement(
    edge: PreparedEdge,
    s: { x: number; y: number },
    t: { x: number; y: number },
  ): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'ig-edge');
    g.setAttribute('data-edge-id', edge.id);
    const type = edge.data.attributes?.type;
    if (typeof type === 'string') g.setAttribute('data-edge-type', type);

    // Visible line.
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'ig-edge-line');
    line.setAttribute('x1', String(s.x));
    line.setAttribute('y1', String(s.y));
    line.setAttribute('x2', String(t.x));
    line.setAttribute('y2', String(t.y));
    line.setAttribute('stroke', edge.color);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('opacity', String(edge.opLow + (edge.opHigh - edge.opLow) / 2));

    const opAnim = document.createElementNS(SVG_NS, 'animate');
    opAnim.setAttribute('attributeName', 'opacity');
    opAnim.setAttribute(
      'values',
      `${edge.opLow};${edge.opHigh};${edge.opLow}`,
    );
    opAnim.setAttribute('dur', `${edge.dur}s`);
    opAnim.setAttribute('repeatCount', 'indefinite');
    line.appendChild(opAnim);
    g.appendChild(line);

    // Hitbox.
    const hit = document.createElementNS(SVG_NS, 'line');
    hit.setAttribute('class', 'ig-edge-hitbox');
    hit.setAttribute('x1', String(s.x));
    hit.setAttribute('y1', String(s.y));
    hit.setAttribute('x2', String(t.x));
    hit.setAttribute('y2', String(t.y));
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '12');
    g.appendChild(hit);

    // Hover label at midpoint.
    const mx = (s.x + t.x) / 2;
    const my = (s.y + t.y) / 2 - 4;
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'ig-edge-label');
    label.setAttribute('x', String(mx));
    label.setAttribute('y', String(my));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', '#a1a1aa');
    label.setAttribute('font-size', '9');
    label.setAttribute('font-family', 'Inter, sans-serif');
    label.setAttribute('opacity', '0');
    label.textContent = typeof type === 'string' ? type : '';
    g.appendChild(label);

    return g;
  }

  private buildNodeElement(
    node: PreparedNode,
    outgoing: EdgeData[],
    incoming: EdgeData[],
  ): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'ig-node');
    g.setAttribute('data-node-id', node.id);
    const type = (node.data.attributes ?? {})['type'];
    if (typeof type === 'string') g.setAttribute('data-node-type', type);

    // 1. Glow halo.
    const glow = document.createElementNS(SVG_NS, 'circle');
    glow.setAttribute('class', 'ig-node-glow');
    glow.setAttribute('cx', String(node.x));
    glow.setAttribute('cy', String(node.y));
    glow.setAttribute('r', String(node.rGlow));
    glow.setAttribute('fill', node.color);
    glow.setAttribute('opacity', '0.1');
    const glowAnim = document.createElementNS(SVG_NS, 'animate');
    glowAnim.setAttribute('attributeName', 'r');
    glowAnim.setAttribute(
      'values',
      `${node.rGlow};${node.rGlowExpanded};${node.rGlow}`,
    );
    glowAnim.setAttribute('dur', `${node.glowDur}s`);
    glowAnim.setAttribute('repeatCount', 'indefinite');
    glow.appendChild(glowAnim);
    g.appendChild(glow);

    // 2. Solid dot with bob animation.
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('class', 'ig-node-dot');
    dot.setAttribute('cx', String(node.x));
    dot.setAttribute('cy', String(node.y));
    dot.setAttribute('r', String(node.rDot));
    dot.setAttribute('fill', node.color);
    const bobAnim = document.createElementNS(SVG_NS, 'animate');
    bobAnim.setAttribute('attributeName', node.bobAxis);
    const center = node.bobAxis === 'cy' ? node.y : node.x;
    bobAnim.setAttribute(
      'values',
      `${center};${center - node.bobAmp};${center}`,
    );
    bobAnim.setAttribute('dur', `${node.bobDur}s`);
    bobAnim.setAttribute('repeatCount', 'indefinite');
    dot.appendChild(bobAnim);
    g.appendChild(dot);

    // 3. Label — plain text NEXT TO the node, no background, no pill.
    if (this.showLabels) {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('class', 'ig-node-label');
      const labelOffset = node.rGlow + 10;
      label.setAttribute('x', String(node.x + labelOffset));
      label.setAttribute('y', String(node.y + 3));
      label.setAttribute('text-anchor', 'start');
      label.setAttribute('fill', '#a1a1aa');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-family', 'Inter, sans-serif');
      label.textContent = SvgRenderer.getLabelText(node.data);
      g.appendChild(label);
    }

    // 4. Hover tooltip.
    g.appendChild(
      this.buildTooltip(node, outgoing, incoming),
    );

    return g;
  }

  private buildTooltip(
    node: PreparedNode,
    outgoing: EdgeData[],
    incoming: EdgeData[],
  ): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'ig-node-tooltip');
    g.setAttribute('opacity', '0');

    const lines = SvgRenderer.buildTooltipLines(node.data, outgoing, incoming);
    const lineHeight = 10;
    const padding = 8;
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    // Approximate width — 4.2 px per char at the chosen font-size + padding.
    const width = Math.max(60, Math.min(220, longest * 4.2 + padding * 2));
    const height = lines.length * lineHeight + padding * 2;

    // Position the tooltip ABOVE the node (or below if too close to top).
    const above = node.y - node.rGlow - height - 4;
    const top = above >= 4 ? above : node.y + node.rGlow + 4;
    const left = Math.max(4, Math.min(400 - width - 4, node.x - width / 2));

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(left));
    rect.setAttribute('y', String(top));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    rect.setAttribute('rx', '4');
    rect.setAttribute('fill', '#1e1e2e');
    rect.setAttribute('stroke', node.color);
    rect.setAttribute('stroke-width', '0.5');
    g.appendChild(rect);

    lines.forEach((text, i) => {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(left + width / 2));
      t.setAttribute(
        'y',
        String(top + padding + i * lineHeight + lineHeight - 2),
      );
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', '#a1a1aa');
      t.setAttribute('font-size', '7.5');
      t.setAttribute('font-family', 'Inter, sans-serif');
      t.textContent = text;
      g.appendChild(t);
    });

    return g;
  }

  private static buildTooltipLines(
    node: NodeData,
    outgoing: EdgeData[],
    incoming: EdgeData[],
  ): string[] {
    const attrs = node.attributes ?? {};
    const lines: string[] = [];

    const titleCandidates = [
      (attrs as { title?: unknown }).title,
      (attrs as { name?: unknown }).name,
      (attrs as { label?: unknown }).label,
    ];
    let title: string | null = null;
    for (const c of titleCandidates) {
      if (typeof c === 'string' && c.length > 0) {
        title = c;
        break;
      }
    }
    if (title) lines.push(title);
    else lines.push(node.id);

    const type = (attrs as { type?: unknown }).type;
    if (typeof type === 'string' && type.length > 0) {
      lines.push(type.charAt(0).toUpperCase() + type.slice(1));
    }

    // Aggregate outgoing edges by relationship type for a short summary.
    if (outgoing.length > 0) {
      const grouped = new Map<string, number>();
      for (const e of outgoing) {
        const t = e.attributes?.type;
        if (typeof t === 'string') grouped.set(t, (grouped.get(t) ?? 0) + 1);
      }
      const summary = [...grouped.entries()]
        .map(([t, n]) => (n > 1 ? `${t} (${n})` : t))
        .slice(0, 2)
        .join(', ');
      if (summary.length > 0) lines.push(summary);
    } else if (incoming.length > 0) {
      const grouped = new Map<string, number>();
      for (const e of incoming) {
        const t = e.attributes?.type;
        if (typeof t === 'string') grouped.set(t, (grouped.get(t) ?? 0) + 1);
      }
      const summary = [...grouped.entries()]
        .map(([t, n]) => (n > 1 ? `${t} (${n})` : t))
        .slice(0, 2)
        .join(', ');
      if (summary.length > 0) lines.push(summary);
    }

    return lines.slice(0, 3);
  }

  private static getLabelText(node: NodeData): string {
    const attrs = node.attributes ?? {};
    const candidates = [
      (attrs as { title?: unknown }).title,
      (attrs as { name?: unknown }).name,
      (attrs as { label?: unknown }).label,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
    }
    return node.id;
  }

  private static createLayoutEngine(mode: LayoutMode): LayoutEngine {
    switch (mode) {
      case 'tree':
        return new TreeLayout();
      case 'graph':
      default:
        return new ForceLayout3D();
    }
  }

  /**
   * Project a 3D position map to 2D viewBox coordinates by dropping z and
   * fitting the bounding box inside `[margin..(size - margin)]` while
   * preserving aspect ratio. SVG y grows downward, so we flip the sign of y.
   */
  private static projectToViewBox(
    positions: Map<string, Vector3>,
    width: number,
    height: number,
    margin: number,
  ): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    if (positions.size === 0) return out;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of positions.values()) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const innerW = width - margin * 2;
    const innerH = height - margin * 2;
    // Preserve aspect: pick the smaller scale so nothing clips.
    const scale = Math.min(innerW / rangeX, innerH / rangeY);
    // Center the projected bbox.
    const cxSrc = (minX + maxX) / 2;
    const cySrc = (minY + maxY) / 2;
    const cxDst = width / 2;
    const cyDst = height / 2;

    for (const [id, p] of positions.entries()) {
      const x = cxDst + (p.x - cxSrc) * scale;
      // Flip y so SVG-down matches conceptual up.
      const y = cyDst - (p.y - cySrc) * scale;
      out.set(id, { x, y });
    }
    return out;
  }

  // Hover behavior driven entirely by CSS — keeps the renderer dependency-free
  // and matches the marketing mockup's approach.
  private static readonly STYLE_CSS: string = `
    .ig-node { cursor: pointer; }
    .ig-node:hover .ig-node-dot { filter: brightness(1.3); }
    .ig-node:hover .ig-node-glow { opacity: 0.25 !important; }
    .ig-node:hover .ig-node-tooltip { opacity: 1; }
    .ig-node:hover .ig-node-label { fill: #e4e4e7; }
    .ig-node-tooltip { transition: opacity 0.2s ease; pointer-events: none; }
    .ig-node-label { transition: fill 0.2s ease; }

    .ig-edge { cursor: pointer; }
    .ig-edge:hover .ig-edge-line { stroke-width: 2.5; opacity: 0.7 !important; }
    .ig-edge:hover .ig-edge-label { opacity: 1 !important; }
    .ig-edge-label { transition: opacity 0.2s ease; pointer-events: none; }
    .ig-edge-line { transition: stroke-width 0.2s ease, opacity 0.2s ease; }
  `;
}
