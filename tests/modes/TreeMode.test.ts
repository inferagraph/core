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

  it('should store options when activated with options', () => {
    const mode = new TreeMode();
    mode.activate({ animated: false });
    expect(mode.options).toEqual({ animated: false });
  });

  it('should default options to empty object when activated without options', () => {
    const mode = new TreeMode();
    mode.activate();
    expect(mode.options).toEqual({});
  });

  it('should replace options on re-activation', () => {
    const mode = new TreeMode();
    mode.activate({ animated: false });
    expect(mode.options).toEqual({ animated: false });

    mode.deactivate();
    mode.activate({ animated: true });
    expect(mode.options).toEqual({ animated: true });
  });
});
