import { describe, it, expect } from 'vitest';
import { TreeMode } from '../../src/modes/TreeMode.js';

describe('TreeMode', () => {
  it('should have name tree', () => {
    expect(new TreeMode().name).toBe('tree');
  });

  it('should activate and deactivate', () => {
    const mode = new TreeMode();
    expect(mode.isActive()).toBe(false);
    mode.activate();
    expect(mode.isActive()).toBe(true);
    mode.deactivate();
    expect(mode.isActive()).toBe(false);
  });
});
