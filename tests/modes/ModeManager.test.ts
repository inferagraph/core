import { describe, it, expect } from 'vitest';
import { ModeManager } from '../../src/modes/ModeManager.js';
import { GraphMode } from '../../src/modes/GraphMode.js';
import { TreeMode } from '../../src/modes/TreeMode.js';

describe('ModeManager', () => {
  it('should register and switch modes', () => {
    const manager = new ModeManager();
    const graphMode = new GraphMode();
    const treeMode = new TreeMode();

    manager.register(graphMode);
    manager.register(treeMode);

    expect(manager.getActive()).toBeNull();

    manager.switch('graph');
    expect(manager.getActive()).toBe('graph');
    expect(graphMode.isActive()).toBe(true);

    manager.switch('tree');
    expect(manager.getActive()).toBe('tree');
    expect(graphMode.isActive()).toBe(false);
    expect(treeMode.isActive()).toBe(true);
  });

  it('should pass options to mode on switch', () => {
    const manager = new ModeManager();
    const graphMode = new GraphMode();
    manager.register(graphMode);

    manager.switch('graph', { animated: false });
    expect(graphMode.options).toEqual({ animated: false });
  });

  it('should pass options when switching between modes', () => {
    const manager = new ModeManager();
    const graphMode = new GraphMode();
    const treeMode = new TreeMode();
    manager.register(graphMode);
    manager.register(treeMode);

    manager.switch('graph', { animated: true });
    expect(graphMode.options).toEqual({ animated: true });

    manager.switch('tree', { animated: false });
    expect(treeMode.options).toEqual({ animated: false });
    expect(graphMode.isActive()).toBe(false);
  });

  it('should work without options (backward compatible)', () => {
    const manager = new ModeManager();
    const graphMode = new GraphMode();
    manager.register(graphMode);

    manager.switch('graph');
    expect(manager.getActive()).toBe('graph');
    expect(graphMode.isActive()).toBe(true);
  });
});
