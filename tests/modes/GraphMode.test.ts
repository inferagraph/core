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

  it('should store options when activated with options', () => {
    const mode = new GraphMode();
    mode.activate({ animated: true });
    expect(mode.options).toEqual({ animated: true });
  });

  it('should default options to empty object when activated without options', () => {
    const mode = new GraphMode();
    mode.activate();
    expect(mode.options).toEqual({});
  });

  it('should replace options on re-activation', () => {
    const mode = new GraphMode();
    mode.activate({ animated: true });
    expect(mode.options).toEqual({ animated: true });

    mode.deactivate();
    mode.activate({ animated: false });
    expect(mode.options).toEqual({ animated: false });
  });
});
