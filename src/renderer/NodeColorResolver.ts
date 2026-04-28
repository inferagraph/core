import type { NodeData } from '../types.js';
import {
  DEFAULT_PALETTE_32,
  autoColor,
  brighten,
} from './palette.js';

/**
 * Fallback color used only when the configured palette is empty. The CSS
 * variable `--ig-node-color` should override this in themed apps; this
 * constant is the absolute floor.
 */
export const DEFAULT_NODE_COLOR = '#3b82f6';

/** Function form: read the node, return a CSS hex/rgb colour. */
export type NodeColorFn = (node: NodeData) => string | undefined;

export interface NodeColorResolverOptions {
  /** Override resolver — wins over both the type-keyed map and the palette. */
  colorFn?: NodeColorFn;
  /** Explicit type → color map. Wins over auto-assignment. */
  nodeColors?: Record<string, string>;
  /**
   * Pool of colors used to deterministically assign a color to types that
   * are not present in `nodeColors`. Defaults to {@link DEFAULT_PALETTE_32}.
   */
  palette?: readonly string[];
  /** Default color used when palette is empty AND nothing else matches. */
  defaultColor?: string;
  /**
   * Multiplier (0..1) used by {@link NodeColorResolver.resolveHover} to lift
   * the resolved color toward white for hover state. Defaults to 0.25.
   */
  hoverBrightness?: number;
}

/**
 * Resolves resting + hover colors for a node based on its attributes.
 *
 * Resolution order (resting):
 *   1. `colorFn(node)` if it returns a non-undefined string
 *   2. `nodeColors[node.attributes.type]` if it's a string lookup
 *   3. `node.attributes.color` if the consumer set one explicitly
 *   4. `palette[hashStringToIndex(type, palette.length)]` (deterministic auto)
 *   5. `defaultColor` (only reached when palette is empty)
 *
 * Hover: same color, brightened by `hoverBrightness` (default 25 % toward white).
 *
 * Domain knowledge note: this resolver ships ZERO domain-specific defaults
 * — the consumer (e.g. Bible Graph) supplies its own `nodeColors` map.
 */
export class NodeColorResolver {
  private readonly colorFn?: NodeColorFn;
  private readonly nodeColors: Record<string, string>;
  private readonly palette: readonly string[];
  private readonly defaultColor: string;
  private readonly hoverBrightness: number;

  constructor(options: NodeColorResolverOptions = {}) {
    this.colorFn = options.colorFn;
    this.nodeColors = { ...(options.nodeColors ?? {}) };
    this.palette = options.palette ?? DEFAULT_PALETTE_32;
    this.defaultColor = options.defaultColor ?? DEFAULT_NODE_COLOR;
    this.hoverBrightness =
      typeof options.hoverBrightness === 'number'
        ? options.hoverBrightness
        : 0.25;
  }

  /** Resting color for `node`. */
  resolve(node: NodeData): string {
    if (this.colorFn) {
      const v = this.colorFn(node);
      if (typeof v === 'string' && v.length > 0) return v;
    }

    const attrs = node.attributes ?? {};
    const type = (attrs as { type?: unknown }).type;

    if (typeof type === 'string' && this.nodeColors[type]) {
      return this.nodeColors[type];
    }

    const explicit = (attrs as { color?: unknown }).color;
    if (typeof explicit === 'string' && explicit.length > 0) return explicit;

    if (typeof type === 'string' && this.palette.length > 0) {
      return autoColor(type, this.palette);
    }

    return this.defaultColor;
  }

  /** Hover color for `node` — resting color brightened toward white. */
  resolveHover(node: NodeData): string {
    return brighten(this.resolve(node), this.hoverBrightness);
  }

  /** The active palette (for tests + introspection). */
  getPalette(): readonly string[] {
    return this.palette;
  }
}
