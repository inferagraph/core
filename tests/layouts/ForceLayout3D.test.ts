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
});
