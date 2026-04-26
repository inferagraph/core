import { describe, it, expect } from 'vitest';
import { ForceLayout3D } from '../../src/layouts/ForceLayout3D.js';

describe('ForceLayout3D', () => {
  it('should have name force-3d', () => {
    const layout = new ForceLayout3D();
    expect(layout.name).toBe('force-3d');
  });

  it('should compute positions for nodes', () => {
    const layout = new ForceLayout3D();
    const positions = layout.compute(['1', '2'], [{ sourceId: '1', targetId: '2' }]);
    expect(positions.size).toBe(2);
    expect(positions.has('1')).toBe(true);
    expect(positions.has('2')).toBe(true);
  });

  it('should default animated to true', () => {
    const layout = new ForceLayout3D();
    expect(layout.animated).toBe(true);
  });

  it('should accept animated=false option', () => {
    const layout = new ForceLayout3D({ animated: false });
    expect(layout.animated).toBe(false);
  });

  it('should tick simulation when animated is true', () => {
    const layout = new ForceLayout3D({ animated: true });
    layout.compute(['a', 'b'], [{ sourceId: 'a', targetId: 'b' }]);

    const positionsBefore = layout.getPositions();
    const aBefore = positionsBefore.get('a')!;

    layout.tick();

    const positionsAfter = layout.getPositions();
    const aAfter = positionsAfter.get('a')!;

    // Positions should change when ticking with animation
    const moved =
      aBefore.x !== aAfter.x || aBefore.y !== aAfter.y || aBefore.z !== aAfter.z;
    expect(moved).toBe(true);
  });

  it('should not tick simulation when animated is false', () => {
    const layout = new ForceLayout3D({ animated: false });
    layout.compute(['a', 'b'], [{ sourceId: 'a', targetId: 'b' }]);

    const positionsBefore = layout.getPositions();
    const aBefore = { ...positionsBefore.get('a')! };

    layout.tick();

    const positionsAfter = layout.getPositions();
    const aAfter = positionsAfter.get('a')!;

    expect(aAfter.x).toBe(aBefore.x);
    expect(aAfter.y).toBe(aBefore.y);
    expect(aAfter.z).toBe(aBefore.z);
  });

  it('should not tick before compute even when animated', () => {
    const layout = new ForceLayout3D({ animated: true });
    // tick before compute should not throw
    layout.tick();
    expect(layout.getPositions().size).toBe(0);
  });

  it('should allow changing animated at runtime via setOptions', () => {
    const layout = new ForceLayout3D({ animated: true });
    expect(layout.animated).toBe(true);

    layout.setOptions({ animated: false });
    expect(layout.animated).toBe(false);
  });
});
