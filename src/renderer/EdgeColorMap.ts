import type { EdgeData } from '../types.js';
import { DEFAULT_PALETTE_32, autoColor, brighten } from './palette.js';

/** Fallback edge color when the palette is empty AND no override matches. */
export const DEFAULT_EDGE_COLOR = '#6366f1';

/**
 * Per-call context handed to {@link EdgeColorFn}. Carries the resolved
 * resting colors of the edge's source + target nodes (the same hex values
 * {@link NodeColorResolver.resolve} would return for those nodes) so the
 * function can derive a colour from its endpoints — for example by
 * blending them, picking one side, or treating same-vs-different as a
 * boolean.
 *
 * Both fields are guaranteed to be valid CSS color strings; callers fall
 * back to {@link DEFAULT_EDGE_COLOR} (or the consumer's chosen
 * fallback) for either side that cannot be resolved against the live
 * graph store.
 */
export interface EdgeColorContext {
  /** Resolved resting color of the source node. */
  sourceColor: string;
  /** Resolved resting color of the target node. */
  targetColor: string;
}

/**
 * Function form: read the edge + its endpoint colours, return a CSS
 * hex/rgb color (or `undefined` to fall through to the type-keyed map /
 * palette).
 *
 * The second argument is optional at call sites that pre-date the context
 * — older `(edge) => string` consumers continue to work because they
 * simply ignore the extra parameter.
 */
export type EdgeColorFn = (
  edge: EdgeData,
  ctx: EdgeColorContext,
) => string | undefined;

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
 *   1. `colorFn(edge, ctx)` if it returns a non-undefined string
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

  /**
   * Resting color for `edge`.
   *
   * `ctx` carries the resolved endpoint colours so a {@link EdgeColorFn}
   * can derive the edge colour from its endpoints (see
   * {@link blendEdgeColors}). The argument is defaulted to the fallback
   * colour on both sides so legacy call sites that don't yet plumb
   * endpoint colours through still produce a sensible result.
   */
  resolve(
    edge: EdgeData,
    ctx: EdgeColorContext = {
      sourceColor: this.defaultColor,
      targetColor: this.defaultColor,
    },
  ): string {
    if (this.colorFn) {
      const v = this.colorFn(edge, ctx);
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
  resolveHover(edge: EdgeData, ctx?: EdgeColorContext): string {
    return brighten(this.resolve(edge, ctx), this.hoverBrightness);
  }

  /** The active palette (for tests + introspection). */
  getPalette(): readonly string[] {
    return this.palette;
  }
}
