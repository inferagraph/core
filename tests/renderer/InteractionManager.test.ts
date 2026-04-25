import { describe, it, expect, vi } from 'vitest';
import { InteractionManager } from '../../src/renderer/InteractionManager.js';

describe('InteractionManager', () => {
  it('should register and fire events', () => {
    const manager = new InteractionManager();
    const callback = vi.fn();
    manager.on('click', callback);
    manager.emit('click', { nodeId: '1', x: 0, y: 0 });
    expect(callback).toHaveBeenCalledWith({ nodeId: '1', x: 0, y: 0 });
  });

  it('should remove event listener', () => {
    const manager = new InteractionManager();
    const callback = vi.fn();
    manager.on('click', callback);
    manager.off('click', callback);
    manager.emit('click', { x: 0, y: 0 });
    expect(callback).not.toHaveBeenCalled();
  });

  it('should clear on detach', () => {
    const manager = new InteractionManager();
    const callback = vi.fn();
    manager.on('click', callback);
    manager.detach();
    manager.emit('click', { x: 0, y: 0 });
    expect(callback).not.toHaveBeenCalled();
  });
});
