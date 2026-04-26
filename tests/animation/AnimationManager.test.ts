import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnimationManager } from '../../src/animation/AnimationManager.js';
import { Tween, Easings } from '../../src/animation/Tween.js';

function createTween(overrides: Partial<{
  from: Record<string, number>;
  to: Record<string, number>;
  duration: number;
  onUpdate: (values: Record<string, number>) => void;
  onComplete: () => void;
}> = {}): Tween<Record<string, number>> {
  return new Tween({
    from: { x: 0 },
    to: { x: 100 },
    duration: 1000,
    easing: Easings.linear,
    ...overrides,
  });
}

describe('AnimationManager', () => {
  let manager: AnimationManager;

  beforeEach(() => {
    manager = new AnimationManager();
  });

  it('should register a tween via add()', () => {
    const tween = createTween();
    manager.add('test', tween);
    expect(manager.get('test')).toBe(tween);
    expect(manager.size).toBe(1);
  });

  it('should replace existing tween with same id and cancel old one', () => {
    const tween1 = createTween();
    tween1.start();
    manager.add('test', tween1);

    const tween2 = createTween();
    manager.add('test', tween2);

    expect(manager.get('test')).toBe(tween2);
    expect(tween1.getState()).toBe('cancelled');
    expect(manager.size).toBe(1);
  });

  it('should cancel and delete tween via remove()', () => {
    const tween = createTween();
    tween.start();
    manager.add('test', tween);
    manager.remove('test');

    expect(tween.getState()).toBe('cancelled');
    expect(manager.get('test')).toBeUndefined();
    expect(manager.size).toBe(0);
  });

  it('should handle remove() for non-existent id gracefully', () => {
    expect(() => manager.remove('nonexistent')).not.toThrow();
  });

  it('should cancel all tweens and clear map via cancelAll()', () => {
    const tween1 = createTween();
    const tween2 = createTween();
    tween1.start();
    tween2.start();
    manager.add('t1', tween1);
    manager.add('t2', tween2);

    manager.cancelAll();

    expect(tween1.getState()).toBe('cancelled');
    expect(tween2.getState()).toBe('cancelled');
    expect(manager.size).toBe(0);
  });

  it('should return tween by id via get()', () => {
    const tween = createTween();
    manager.add('myTween', tween);
    expect(manager.get('myTween')).toBe(tween);
  });

  it('should return undefined for unknown id via get()', () => {
    expect(manager.get('unknown')).toBeUndefined();
  });

  it('should count running tweens via getActiveCount()', () => {
    const tween1 = createTween();
    const tween2 = createTween();
    const tween3 = createTween();

    tween1.start();
    tween2.start();
    // tween3 stays idle

    manager.add('t1', tween1);
    manager.add('t2', tween2);
    manager.add('t3', tween3);

    expect(manager.getActiveCount()).toBe(2);
  });

  it('should advance all tweens via update()', () => {
    const onUpdate1 = vi.fn();
    const onUpdate2 = vi.fn();

    const tween1 = createTween({ onUpdate: onUpdate1 });
    const tween2 = createTween({ onUpdate: onUpdate2 });

    tween1.start();
    tween2.start();

    manager.add('t1', tween1);
    manager.add('t2', tween2);

    manager.update(500);

    expect(onUpdate1).toHaveBeenCalledTimes(1);
    expect(onUpdate2).toHaveBeenCalledTimes(1);
  });

  it('should remove completed tweens automatically after update()', () => {
    const tween = createTween({ duration: 500 });
    tween.start();
    manager.add('test', tween);

    expect(manager.size).toBe(1);
    manager.update(600); // exceeds duration, should complete and be removed
    expect(manager.size).toBe(0);
  });

  it('should remove cancelled tweens during update()', () => {
    const tween = createTween();
    tween.start();
    manager.add('test', tween);
    tween.cancel();

    manager.update(100);
    expect(manager.size).toBe(0);
  });

  it('should track running state via start()/stop()/isRunning()', () => {
    expect(manager.isRunning()).toBe(false);
    manager.start();
    expect(manager.isRunning()).toBe(true);
    manager.stop();
    expect(manager.isRunning()).toBe(false);
  });

  it('should not start multiple loops if start() called repeatedly', () => {
    manager.start();
    manager.start(); // should be no-op
    expect(manager.isRunning()).toBe(true);
    manager.stop();
  });

  it('should return total tween count via size', () => {
    manager.add('t1', createTween());
    manager.add('t2', createTween());
    manager.add('t3', createTween());
    expect(manager.size).toBe(3);
  });

  it('should call setOnFrame callback during update()', () => {
    const onFrame = vi.fn();
    manager.setOnFrame(onFrame);

    manager.update(16);

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith(16);
  });

  it('should call onFrame even when there are no tweens', () => {
    const onFrame = vi.fn();
    manager.setOnFrame(onFrame);
    manager.update(16);
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it('should update multiple concurrent tweens independently', () => {
    const values1: number[] = [];
    const values2: number[] = [];

    const tween1 = createTween({
      from: { x: 0 },
      to: { x: 100 },
      duration: 1000,
      onUpdate: (v) => values1.push(v.x),
    });

    const tween2 = createTween({
      from: { x: 200 },
      to: { x: 400 },
      duration: 2000,
      onUpdate: (v) => values2.push(v.x),
    });

    tween1.start();
    tween2.start();

    manager.add('t1', tween1);
    manager.add('t2', tween2);

    manager.update(500);

    // tween1: 50% through (linear), x = 50
    expect(values1[0]).toBeCloseTo(50);
    // tween2: 25% through (linear), x = 200 + 0.25 * 200 = 250
    expect(values2[0]).toBeCloseTo(250);

    manager.update(500);

    // tween1: 100% through, x = 100, should complete
    expect(values1[1]).toBeCloseTo(100);
    // tween2: 50% through, x = 200 + 0.5 * 200 = 300
    expect(values2[1]).toBeCloseTo(300);

    // tween1 should be removed (completed)
    expect(manager.size).toBe(1);
    expect(manager.get('t1')).toBeUndefined();
    expect(manager.get('t2')).toBeDefined();
  });

  it('should not remove idle tweens during update()', () => {
    const tween = createTween();
    // Don't start it - stays idle
    manager.add('idle', tween);
    manager.update(500);
    // Idle tweens are not running, update returns false, but state is 'idle'
    // They should NOT be removed since they are not completed/cancelled
    expect(manager.size).toBe(1);
    expect(manager.get('idle')).toBe(tween);
  });
});
