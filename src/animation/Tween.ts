export type EasingFunction = (t: number) => number;

export const Easings = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeOutCubic: (t: number) => (--t) * t * t + 1,
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  spring: (t: number) => 1 - Math.cos(t * Math.PI * 0.5) * Math.exp(-6 * t),
} as const;

export type TweenState = 'idle' | 'running' | 'completed' | 'canceled';

export class Tween<T extends Record<string, number>> {
  private from: T;
  private to: T;
  private current: T;
  private duration: number;
  private elapsed: number = 0;
  private easing: EasingFunction;
  private state: TweenState = 'idle';
  private onUpdate?: (values: T) => void;
  private onComplete?: () => void;

  constructor(options: {
    from: T;
    to: T;
    duration: number;
    easing?: EasingFunction;
    onUpdate?: (values: T) => void;
    onComplete?: () => void;
  }) {
    this.from = { ...options.from };
    this.to = { ...options.to };
    this.current = { ...options.from };
    this.duration = options.duration;
    this.easing = options.easing ?? Easings.easeOutQuad;
    this.onUpdate = options.onUpdate;
    this.onComplete = options.onComplete;
  }

  start(): void {
    this.state = 'running';
    this.elapsed = 0;
  }

  /** Advance by deltaMs. Returns true if still running. */
  update(deltaMs: number): boolean {
    if (this.state !== 'running') return false;

    this.elapsed += deltaMs;
    const rawT = Math.min(this.elapsed / this.duration, 1);
    const t = this.easing(rawT);

    // Interpolate each property
    const keys = Object.keys(this.from) as (keyof T)[];
    for (const key of keys) {
      (this.current as Record<string, number>)[key as string] =
        (this.from[key] as number) + ((this.to[key] as number) - (this.from[key] as number)) * t;
    }

    this.onUpdate?.(this.current);

    if (rawT >= 1) {
      this.state = 'completed';
      this.onComplete?.();
      return false;
    }
    return true;
  }

  cancel(): void {
    this.state = 'canceled';
  }

  getState(): TweenState { return this.state; }
  getCurrent(): T { return { ...this.current }; }
  getProgress(): number { return Math.min(this.elapsed / this.duration, 1); }
}
