import { describe, it, expect, vi } from 'vitest';
import { Tween, Easings } from '../../src/animation/Tween.js';

describe('Tween', () => {
  it('should start in idle state', () => {
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
    });
    expect(tween.getState()).toBe('idle');
  });

  it('should set state to running after start()', () => {
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
    });
    tween.start();
    expect(tween.getState()).toBe('running');
  });

  it('should interpolate values correctly with linear easing at 50%', () => {
    const tween = new Tween({
      from: { x: 0, y: 100 },
      to: { x: 100, y: 200 },
      duration: 1000,
      easing: Easings.linear,
    });
    tween.start();
    tween.update(500); // 50%
    const current = tween.getCurrent();
    expect(current.x).toBeCloseTo(50);
    expect(current.y).toBeCloseTo(150);
  });

  it('should complete when elapsed >= duration and set state to completed', () => {
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
      easing: Easings.linear,
    });
    tween.start();
    const stillRunning = tween.update(1000);
    expect(stillRunning).toBe(false);
    expect(tween.getState()).toBe('completed');
    expect(tween.getCurrent().x).toBeCloseTo(100);
  });

  it('should complete when elapsed overshoots duration', () => {
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
      easing: Easings.linear,
    });
    tween.start();
    const stillRunning = tween.update(1500);
    expect(stillRunning).toBe(false);
    expect(tween.getState()).toBe('completed');
    expect(tween.getCurrent().x).toBeCloseTo(100);
  });

  it('should set state to canceled and return false on update after cancel()', () => {
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
    });
    tween.start();
    tween.cancel();
    expect(tween.getState()).toBe('canceled');
    const stillRunning = tween.update(100);
    expect(stillRunning).toBe(false);
  });

  it('should call onUpdate callback with interpolated values', () => {
    const onUpdate = vi.fn();
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
      easing: Easings.linear,
      onUpdate,
    });
    tween.start();
    tween.update(500);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const arg = onUpdate.mock.calls[0][0];
    expect(arg.x).toBeCloseTo(50);
  });

  it('should call onComplete callback when tween finishes', () => {
    const onComplete = vi.fn();
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
      onComplete,
    });
    tween.start();
    tween.update(500);
    expect(onComplete).not.toHaveBeenCalled();
    tween.update(500);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('should interpolate multiple properties simultaneously', () => {
    const tween = new Tween({
      from: { x: 0, y: 0, z: 0 },
      to: { x: 100, y: 200, z: 300 },
      duration: 1000,
      easing: Easings.linear,
    });
    tween.start();
    tween.update(500);
    const current = tween.getCurrent();
    expect(current.x).toBeCloseTo(50);
    expect(current.y).toBeCloseTo(100);
    expect(current.z).toBeCloseTo(150);
  });

  it('should return false from update() when state is idle', () => {
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
    });
    const result = tween.update(100);
    expect(result).toBe(false);
  });

  describe('Easing functions', () => {
    it('linear should return t', () => {
      expect(Easings.linear(0)).toBe(0);
      expect(Easings.linear(0.5)).toBe(0.5);
      expect(Easings.linear(1)).toBe(1);
    });

    it('easeInQuad should return t*t', () => {
      expect(Easings.easeInQuad(0)).toBe(0);
      expect(Easings.easeInQuad(0.5)).toBeCloseTo(0.25);
      expect(Easings.easeInQuad(1)).toBe(1);
    });

    it('easeOutQuad should return t*(2-t)', () => {
      expect(Easings.easeOutQuad(0)).toBe(0);
      expect(Easings.easeOutQuad(0.5)).toBeCloseTo(0.75);
      expect(Easings.easeOutQuad(1)).toBe(1);
    });

    it('easeInOutQuad should transition smoothly', () => {
      expect(Easings.easeInOutQuad(0)).toBe(0);
      expect(Easings.easeInOutQuad(0.25)).toBeCloseTo(0.125);
      expect(Easings.easeInOutQuad(0.5)).toBeCloseTo(0.5);
      expect(Easings.easeInOutQuad(1)).toBe(1);
    });

    it('easeOutCubic should reach 1 at t=1', () => {
      expect(Easings.easeOutCubic(0)).toBeCloseTo(0);
      expect(Easings.easeOutCubic(1)).toBeCloseTo(1);
    });

    it('easeInOutCubic should transition smoothly', () => {
      expect(Easings.easeInOutCubic(0)).toBe(0);
      expect(Easings.easeInOutCubic(0.5)).toBeCloseTo(0.5);
      expect(Easings.easeInOutCubic(1)).toBeCloseTo(1);
    });

    it('spring should settle near 1 at t=1', () => {
      const value = Easings.spring(1);
      expect(value).toBeCloseTo(1, 1);
    });

    it('spring should start at 0', () => {
      expect(Easings.spring(0)).toBeCloseTo(0);
    });
  });

  it('should return correct progress via getProgress()', () => {
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
      easing: Easings.linear,
    });
    expect(tween.getProgress()).toBe(0);
    tween.start();
    tween.update(250);
    expect(tween.getProgress()).toBeCloseTo(0.25);
    tween.update(250);
    expect(tween.getProgress()).toBeCloseTo(0.5);
    tween.update(500);
    expect(tween.getProgress()).toBeCloseTo(1);
  });

  it('should clamp getProgress() at 1 when overshooting', () => {
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
    });
    tween.start();
    tween.update(2000);
    expect(tween.getProgress()).toBe(1);
  });

  it('should return a snapshot from getCurrent() that is not affected by further updates', () => {
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
      easing: Easings.linear,
    });
    tween.start();
    tween.update(500);
    const snapshot = tween.getCurrent();
    tween.update(500);
    // The snapshot should still have the value at 50%
    expect(snapshot.x).toBeCloseTo(50);
    // The tween itself should now be at 100%
    expect(tween.getCurrent().x).toBeCloseTo(100);
  });

  it('should complete immediately with zero duration', () => {
    const onComplete = vi.fn();
    const onUpdate = vi.fn();
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 0,
      easing: Easings.linear,
      onUpdate,
      onComplete,
    });
    tween.start();
    // Any positive deltaMs should complete it since elapsed/0 would be Infinity
    // But we clamp rawT to 1, so it should complete
    // However, duration is 0, so elapsed / duration = Infinity, clamped to 1
    // This means even a tiny update completes the tween
    const stillRunning = tween.update(1);
    expect(stillRunning).toBe(false);
    expect(tween.getState()).toBe('completed');
    expect(tween.getCurrent().x).toBeCloseTo(100);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('should use easeOutQuad as default easing', () => {
    const tween = new Tween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
    });
    tween.start();
    tween.update(500); // rawT = 0.5
    const current = tween.getCurrent();
    // easeOutQuad(0.5) = 0.5 * (2 - 0.5) = 0.75
    expect(current.x).toBeCloseTo(75);
  });
});
