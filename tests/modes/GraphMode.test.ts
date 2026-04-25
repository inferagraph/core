import { describe, it, expect } from 'vitest';
import { GraphMode } from '../../src/modes/GraphMode.js';

describe('GraphMode', () => {
  it('should have name graph', () => {
    expect(new GraphMode().name).toBe('graph');
  });

  it('should activate and deactivate', () => {
    const mode = new GraphMode();
    expect(mode.isActive()).toBe(false);
    mode.activate();
    expect(mode.isActive()).toBe(true);
    mode.deactivate();
    expect(mode.isActive()).toBe(false);
  });
});
