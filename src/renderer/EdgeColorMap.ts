import type { EdgeData } from '../types.js';
import { DEFAULT_PALETTE_32, autoColor, brighten } from './palette.js';

/** Fallback edge color when the palette is empty AND no override matches. */
export const DEFAULT_EDGE_COLOR = '#6366f1';

/** Function form: read the edge, return a CSS hex/rgb color. */
export type EdgeColorFn = (edge: EdgeData) => string | undefined;

export interface EdgeColorMapOptions {
  /** Override resolver — wins over both the type-keyed map and the palette. */
  colorFn?: EdgeColorFn;
  /** Explicit type → color map. Wins over auto-assignment. */
  edgeColors?: Record<string, string>;
  /**
   * Pool of colors used to deterministically assign a color to relationship
   * types not present in `edgeColors`. Defaults to {@link DEFAULT_PALETTE_32}.
   */
  palette?: readonly string[];
  /** Default color used when palette is empty AND nothing else matches. */
  defaultColor?: string;
  /**
   * Multiplier (0..1) used by {@link EdgeColorMap.resolveHover} to lift the
   * resolved color toward white for hover state. Defaults to 0.25.
   */
  hoverBrightness?: number;
}

/**
 * Resolves resting + hover colors for an edge based on its `attributes.type`
 * (the relationship type, e.g. `father_of`).
 *
 * Resolution order (resting):
 *   1. `colorFn(edge)` if it returns a non-undefined string
 *   2. `edgeColors[edge.attributes.type]`
 *   3. `palette[hashStringToIndex(type, palette.length)]` (deterministic auto)
 *   4. `defaultColor` (only reached when palette is empty)
 *
 * Hover: same color, brightened by `hoverBrightness` (default 25 % toward white).
 *
 * Domain knowledge note: this map ships ZERO domain-specific defaults —
 * `father_of`, `married_to`, etc. mean nothing to InferaGraph. The consumer
 * (e.g. Bible Graph) supplies its own `edgeColors` map.
 */
export class EdgeColorMap {
  private readonly colorFn?: EdgeColorFn;
  private readonly edgeColors: Record<string, string>;
  private readonly palette: readonly string[];
  private readonly defaultColor: string;
  private readonly hoverBrightness: number;

  constructor(options: EdgeColorMapOptions = {}) {
    this.colorFn = options.colorFn;
    this.edgeColors = { ...(options.edgeColors ?? {}) };
    this.palette = options.palette ?? DEFAULT_PALETTE_32;
    this.defaultColor = options.defaultColor ?? DEFAULT_EDGE_COLOR;
    this.hoverBrightness =
      typeof options.hoverBrightness === 'number'
        ? options.hoverBrightness
        : 0.25;
  }

  /** Resting color for `edge`. */
  resolve(edge: EdgeData): string {
    if (this.colorFn) {
      const v = this.colorFn(edge);
      if (typeof v === 'string' && v.length > 0) return v;
    }

    const type = edge.attributes?.type;
    if (typeof type === 'string' && this.edgeColors[type]) {
      return this.edgeColors[type];
    }

    if (typeof type === 'string' && this.palette.length > 0) {
      return autoColor(type, this.palette);
    }

    return this.defaultColor;
  }

  /** Hover color for `edge` — resting color brightened toward white. */
  resolveHover(edge: EdgeData): string {
    return brighten(this.resolve(edge), this.hoverBrightness);
  }

  /** The active palette (for tests + introspection). */
  getPalette(): readonly string[] {
    return this.palette;
  }
}
