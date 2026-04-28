import type { NodeData } from '../types.js';

/**
 * Resolves a node's display color. Domain-agnostic — the default palette is a
 * sensible fallback indexed by the convention `attributes.type` (e.g. 'person',
 * 'place', 'event'), but consumers can plug in their own resolver to colour
 * nodes by any attribute.
 *
 * Implementation note: InferaGraph core has zero domain knowledge; the keys
 * below are the keys that real-world consumers (e.g. the Bible Graph app)
 * happen to use. Any unknown key falls through to {@link DEFAULT_NODE_COLOR}.
 */
export const DEFAULT_NODE_COLOR = '#3D8DAF';

/**
 * Default per-type colour palette. Mirrors the marketing site's accent
 * palette: cool blues for people/places, warm oranges/yellows for the more
 * collective entities, deep orange for events.
 */
export const DEFAULT_NODE_COLOR_PALETTE: Readonly<Record<string, string>> = Object.freeze({
  person: '#3D8DAF',
  place: '#2A6480',
  clan: '#F0A03A',
  group: '#F5C13F',
  event: '#E47A2A',
});

/**
 * Hover colour palette — slightly lighter / brighter than the resting palette
 * so the active node lifts off the canvas without requiring per-frame light
 * recomputation.
 */
export const DEFAULT_NODE_HOVER_PALETTE: Readonly<Record<string, string>> = Object.freeze({
  person: '#6FB3CF',
  place: '#5894B0',
  clan: '#FFC272',
  group: '#FFDA73',
  event: '#FFA060',
});

export const DEFAULT_NODE_HOVER_COLOR = '#6FB3CF';

/** Function form: read the node, return a CSS hex/rgb colour. */
export type NodeColorFn = (node: NodeData) => string;

export interface NodeColorResolverOptions {
  /** Override resolver — wins over both the type-keyed map and the default palette. */
  colorFn?: NodeColorFn;
  /** Override the resting palette keyed by `attributes.type`. */
  palette?: Record<string, string>;
  /** Override the hover palette keyed by `attributes.type`. */
  hoverPalette?: Record<string, string>;
  /** Default colour returned when nothing else matches. */
  defaultColor?: string;
  /** Default hover colour returned when nothing else matches. */
  defaultHoverColor?: string;
}

/**
 * Resolves resting + hover colours for a node based on its attributes.
 *
 * Resolution order (resting):
 *   1. `colorFn(node)` if provided
 *   2. `palette[node.attributes.type]` if it's a string lookup
 *   3. `node.attributes.color` if the consumer set one explicitly
 *   4. `defaultColor`
 *
 * Hover colour resolution mirrors that, with `hoverPalette` and
 * `defaultHoverColor`.
 */
export class NodeColorResolver {
  private readonly colorFn?: NodeColorFn;
  private readonly palette: Record<string, string>;
  private readonly hoverPalette: Record<string, string>;
  private readonly defaultColor: string;
  private readonly defaultHoverColor: string;

  constructor(options: NodeColorResolverOptions = {}) {
    this.colorFn = options.colorFn;
    this.palette = { ...DEFAULT_NODE_COLOR_PALETTE, ...(options.palette ?? {}) };
    this.hoverPalette = { ...DEFAULT_NODE_HOVER_PALETTE, ...(options.hoverPalette ?? {}) };
    this.defaultColor = options.defaultColor ?? DEFAULT_NODE_COLOR;
    this.defaultHoverColor = options.defaultHoverColor ?? DEFAULT_NODE_HOVER_COLOR;
  }

  /** Resting colour for `node`. */
  resolve(node: NodeData): string {
    if (this.colorFn) return this.colorFn(node);

    const type = node.attributes?.type;
    if (typeof type === 'string' && this.palette[type]) {
      return this.palette[type];
    }

    const explicit = node.attributes?.color;
    if (typeof explicit === 'string') return explicit;

    return this.defaultColor;
  }

  /** Hover colour for `node`. */
  resolveHover(node: NodeData): string {
    const type = node.attributes?.type;
    if (typeof type === 'string' && this.hoverPalette[type]) {
      return this.hoverPalette[type];
    }
    return this.defaultHoverColor;
  }
}
