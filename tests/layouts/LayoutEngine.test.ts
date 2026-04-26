import { describe, it, expect } from 'vitest';
import { LayoutEngine } from '../../src/layouts/LayoutEngine.js';
import type { NodeId, Vector3 } from '../../src/types.js';

class TestLayout extends LayoutEngine {
  readonly name = 'test';

  compute(
    nodeIds: NodeId[],
    _edges: Array<{ sourceId: NodeId; targetId: NodeId }>,
  ): Map<NodeId, Vector3> {
    const positions = new Map<NodeId, Vector3>();
    for (const id of nodeIds) {
      positions.set(id, { x: 0, y: 0, z: 0 });
    }
    return positions;
  }

  tick(): void {
    // no-op
  }

  getPositions(): Map<NodeId, Vector3> {
    return new Map();
  }
}

describe('LayoutEngine', () => {
  it('should default animated to true when no options provided', () => {
    const layout = new TestLayout();
    expect(layout.animated).toBe(true);
  });

  it('should respect animated=false from constructor options', () => {
    const layout = new TestLayout({ animated: false });
    expect(layout.animated).toBe(false);
  });

  it('should respect animated=true from constructor options', () => {
    const layout = new TestLayout({ animated: true });
    expect(layout.animated).toBe(true);
  });

  it('should update animated via setOptions', () => {
    const layout = new TestLayout({ animated: true });
    expect(layout.animated).toBe(true);

    layout.setOptions({ animated: false });
    expect(layout.animated).toBe(false);
  });

  it('should merge options in setOptions, not replace', () => {
    const layout = new TestLayout({ animated: true });
    layout.setOptions({}); // pass empty, should keep animated: true
    expect(layout.animated).toBe(true);
  });
});
