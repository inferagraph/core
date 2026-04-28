/**
 * Per-frame "breathing" pulse for instanced node meshes.
 *
 * Modulates the scale of each instance using a sine wave with a per-node
 * phase offset so the swarm feels alive without metronome-style synchrony.
 * The position passed into `updateInstance` is the layout-driven base
 * position; only the instance scale changes from frame to frame.
 *
 * Hover-excluded indices are intentionally skipped — a node the user is
 * actively interacting with should feel "stable", not animated.
 */
import type { NodeMesh } from './NodeMesh.js';
import type { NodeData, Vector3 } from '../types.js';

/** Public configuration shape exposed via SceneControllerOptions. */
export interface PulseConfig {
  /** When false, no scale modulation is applied. Default: true. */
  enabled?: boolean;
  /** Period of one full sine cycle in milliseconds. Default: 2500. */
  period?: number;
  /**
   * Peak scale offset above the resting size, expressed as a fraction.
   * 0.06 means the node grows / shrinks by 6 % at the wave's extremes.
   * Default: 0.06.
   */
  amplitude?: number;
  /**
   * Optional secondary HSL lightness lift (0..1). Each pulse cycle the
   * node's colour brightens by up to `colorAmplitude`. Default: 0
   * (disabled — keep the renderer cheap by default).
   */
  colorAmplitude?: number;
  /**
   * Multiplier applied to amplitude / inverse multiplier applied to period
   * for nodes registered as "highlighted" via `setHighlight()`. Default: 2.
   */
  highlightMultiplier?: number;
  /**
   * Time source — defaults to `Date.now`. Tests inject a fixed clock so
   * scale assertions are deterministic.
   */
  now?: () => number;
}

/** Internal, fully-resolved configuration. */
interface ResolvedPulseConfig {
  enabled: boolean;
  period: number;
  amplitude: number;
  colorAmplitude: number;
  highlightMultiplier: number;
  now: () => number;
}

/** Public input form: a flag, a partial config, or undefined. */
export type PulseOption = boolean | PulseConfig | undefined;

const DEFAULTS: ResolvedPulseConfig = {
  enabled: true,
  period: 2500,
  amplitude: 0.06,
  colorAmplitude: 0,
  highlightMultiplier: 2,
  now: () => Date.now(),
};

export const DEFAULT_PULSE_CONFIG: Readonly<PulseConfig> = Object.freeze({
  enabled: true,
  period: 2500,
  amplitude: 0.06,
});

function resolve(option: PulseOption): ResolvedPulseConfig {
  if (option === false) {
    return { ...DEFAULTS, enabled: false };
  }
  if (option === undefined || option === true) {
    return { ...DEFAULTS };
  }
  return {
    ...DEFAULTS,
    ...option,
    enabled: option.enabled ?? DEFAULTS.enabled,
  };
}

/**
 * Deterministically pick a phase offset (0..2π) per node id so the swarm
 * pulses out of sync. A simple multiplicative-hash keeps the offset
 * stable across re-renders without storing per-node state.
 */
function phaseOffsetFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Normalise to [0, 2π).
  const u = (h >>> 0) / 0xffffffff;
  return u * Math.PI * 2;
}

/** Lift a `#rrggbb` colour's HSL lightness by `delta` (0..1). */
function liftLightness(hex: string, delta: number): string {
  if (delta === 0) return hex;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;

  // RGB -> HSL
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h /= 6;
  }

  const newL = Math.max(0, Math.min(1, l + delta));

  // HSL -> RGB
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r2: number, g2: number, b2: number;
  if (s === 0) {
    r2 = g2 = b2 = newL;
  } else {
    const q = newL < 0.5 ? newL * (1 + s) : newL + s - newL * s;
    const p = 2 * newL - q;
    r2 = hue2rgb(p, q, h + 1 / 3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number): string => {
    const x = Math.round(v * 255).toString(16);
    return x.length === 1 ? '0' + x : x;
  };
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

/**
 * Drives the per-frame pulse. Stateless w.r.t. the layout; reads the
 * supplied positions + base colours each tick.
 */
export class PulseController {
  private config: ResolvedPulseConfig;
  private excludeIndex: number | null = null;
  private highlightedIndexes = new Set<number>();
  private phaseCache = new Map<string, number>();

  constructor(option?: PulseOption) {
    this.config = resolve(option);
  }

  /** Replace the current configuration. Accepts the same shape as the option. */
  setConfig(option: PulseOption): void {
    this.config = resolve(option);
  }

  /** Read the active configuration. Useful for tests + introspection. */
  getConfig(): Readonly<ResolvedPulseConfig> {
    return this.config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  /** Skip this index when computing the next pulse frame (e.g. hovered). */
  setExcludedIndex(index: number | null): void {
    this.excludeIndex = index;
  }

  getExcludedIndex(): number | null {
    return this.excludeIndex;
  }

  /** Mark indices that should pulse with a stronger / faster amplitude. */
  setHighlightedIndexes(indexes: Iterable<number>): void {
    this.highlightedIndexes = new Set(indexes);
  }

  /** Compute the (multiplicative) scale factor for `nodeId` at time `now`. */
  computeScale(nodeId: string, now: number, isHighlighted = false): number {
    if (!this.config.enabled) return 1;
    const period = isHighlighted ? this.config.period / this.config.highlightMultiplier : this.config.period;
    const amplitude = isHighlighted ? this.config.amplitude * this.config.highlightMultiplier : this.config.amplitude;
    const phase = (now / period) * Math.PI * 2 + this.phaseFor(nodeId);
    return 1 + amplitude * Math.sin(phase);
  }

  /** Compute the (lightness-lifted) colour for `nodeId` at time `now`. */
  computeColor(nodeId: string, baseColor: string, now: number, isHighlighted = false): string {
    if (!this.config.enabled || this.config.colorAmplitude === 0) return baseColor;
    const period = isHighlighted ? this.config.period / this.config.highlightMultiplier : this.config.period;
    const colorAmp = isHighlighted ? this.config.colorAmplitude * this.config.highlightMultiplier : this.config.colorAmplitude;
    const phase = (now / period) * Math.PI * 2 + this.phaseFor(nodeId);
    // Map sine [-1,1] to lightness lift [0, colorAmp].
    const lift = colorAmp * 0.5 * (1 + Math.sin(phase));
    return liftLightness(baseColor, lift);
  }

  /**
   * Apply pulse-driven scale / colour to every entry in `nodeIds`, skipping
   * the configured hover index. Caller supplies layout positions and the
   * resting colour; PulseController handles the rest.
   */
  apply(
    mesh: NodeMesh,
    nodeIds: ReadonlyArray<string>,
    positions: ReadonlyMap<string, Vector3>,
    baseColors: ReadonlyArray<string>,
  ): void {
    if (!this.config.enabled) return;
    const now = this.config.now();
    for (let i = 0; i < nodeIds.length; i++) {
      if (i === this.excludeIndex) continue;
      const id = nodeIds[i];
      const pos = positions.get(id);
      if (!pos) continue;
      const isHighlighted = this.highlightedIndexes.has(i);
      const scale = this.computeScale(id, now, isHighlighted);
      const color = this.computeColor(id, baseColors[i], now, isHighlighted);
      const baseRadius = mesh.getRadius();
      mesh.updateInstance(i, pos, color, baseRadius * scale);
    }
  }

  /**
   * For nodes that ARE in the excluded set, write the resting position
   * + base colour without a scale modulation. Used to "snap back" a
   * formerly-pulsing node when hover starts so it doesn't freeze mid-pulse.
   */
  applyResting(
    mesh: NodeMesh,
    index: number,
    nodeId: string,
    position: Vector3,
    baseColor: string,
  ): void {
    void nodeId;
    mesh.updateInstance(index, position, baseColor, mesh.getRadius());
  }

  /**
   * Convenience for callers that just want the per-node phase offset
   * (e.g. tests asserting that two ids produce different offsets).
   */
  phaseFor(id: string): number {
    let p = this.phaseCache.get(id);
    if (p === undefined) {
      p = phaseOffsetFor(id);
      this.phaseCache.set(id, p);
    }
    return p;
  }

  /** Drop cached per-node phases (e.g. when the graph is rebuilt). */
  reset(node?: NodeData): void {
    if (node) {
      this.phaseCache.delete(node.id);
    } else {
      this.phaseCache.clear();
      this.excludeIndex = null;
      this.highlightedIndexes.clear();
    }
  }
}
