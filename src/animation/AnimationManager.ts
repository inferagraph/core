import { Tween } from './Tween.js';

export class AnimationManager {
  private tweens = new Map<string, Tween<Record<string, number>>>();
  private lastTime: number = 0;
  private running = false;
  private onFrame?: (deltaMs: number) => void;

  /** Register a tween by id. Replaces existing tween with same id. */
  add(id: string, tween: Tween<Record<string, number>>): void {
    // Cancel existing tween with same id
    const existing = this.tweens.get(id);
    if (existing) existing.cancel();
    this.tweens.set(id, tween);
  }

  /** Remove a tween by id */
  remove(id: string): void {
    const tween = this.tweens.get(id);
    if (tween) {
      tween.cancel();
      this.tweens.delete(id);
    }
  }

  /** Cancel all tweens */
  cancelAll(): void {
    for (const tween of this.tweens.values()) {
      tween.cancel();
    }
    this.tweens.clear();
  }

  /** Get a tween by id */
  get(id: string): Tween<Record<string, number>> | undefined {
    return this.tweens.get(id);
  }

  /** Get count of active tweens */
  getActiveCount(): number {
    let count = 0;
    for (const tween of this.tweens.values()) {
      if (tween.getState() === 'running') count++;
    }
    return count;
  }

  /** Set callback for each animation frame */
  setOnFrame(callback: (deltaMs: number) => void): void {
    this.onFrame = callback;
  }

  /** Update all tweens with deltaMs. Remove completed ones. */
  update(deltaMs: number): void {
    const toRemove: string[] = [];
    for (const [id, tween] of this.tweens) {
      const stillRunning = tween.update(deltaMs);
      if (!stillRunning && (tween.getState() === 'completed' || tween.getState() === 'canceled')) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.tweens.delete(id);
    }
    this.onFrame?.(deltaMs);
  }

  /** Start internal animation loop using requestAnimationFrame */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.tick();
  }

  /** Stop internal animation loop */
  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Number of tweens (including completed) */
  get size(): number {
    return this.tweens.size;
  }

  private tick = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const delta = now - this.lastTime;
    this.lastTime = now;
    this.update(delta);
    requestAnimationFrame(this.tick);
  };
}
