import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExpandAffordance } from '../../src/renderer/ExpandAffordance.js';

describe('ExpandAffordance', () => {
  let container: HTMLDivElement;
  let affordance: ExpandAffordance;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    affordance = new ExpandAffordance();
    affordance.attach(container);
  });

  afterEach(() => {
    affordance.detach();
    container.remove();
  });

  it('mounts a sibling overlay + button on attach', () => {
    const overlay = container.querySelector<HTMLDivElement>('.ig-affordance-overlay');
    expect(overlay).not.toBeNull();
    const button = overlay!.querySelector<HTMLButtonElement>('.ig-expand-affordance');
    expect(button).not.toBeNull();
    expect(button!.tagName).toBe('BUTTON');
    expect(button!.type).toBe('button');
    expect(button!.getAttribute('aria-label')).toBe('Expand neighbors');
    expect(button!.textContent).toBe('+');
  });

  it('starts hidden (display: none)', () => {
    const button = affordance.getButton()!;
    expect(button.style.display).toBe('none');
    expect(affordance.getCurrentNodeId()).toBeNull();
  });

  it('show(nodeId) reveals the button and writes data-node-id', () => {
    affordance.show('node-1');
    const button = affordance.getButton()!;
    expect(button.style.display).toBe('flex');
    expect(button.dataset.nodeId).toBe('node-1');
    expect(affordance.getCurrentNodeId()).toBe('node-1');
  });

  it('show(nodeId) re-targets the same button across nodes', () => {
    affordance.show('node-1');
    affordance.show('node-2');
    const button = affordance.getButton()!;
    expect(button.dataset.nodeId).toBe('node-2');
    expect(affordance.getCurrentNodeId()).toBe('node-2');
    // Still exactly one button in the DOM — no leak.
    expect(container.querySelectorAll('.ig-expand-affordance').length).toBe(1);
  });

  it('hide() flips display back to none and clears the cached node id', () => {
    affordance.show('node-1');
    affordance.hide();
    const button = affordance.getButton()!;
    expect(button.style.display).toBe('none');
    expect(button.dataset.nodeId).toBeUndefined();
    expect(affordance.getCurrentNodeId()).toBeNull();
  });

  it('updatePosition(x, y) writes a translate transform with offset variables', () => {
    affordance.show('a');
    affordance.updatePosition(150, 200);
    const button = affordance.getButton()!;
    expect(button.style.transform).toContain('translate(150px, 200px)');
    expect(button.style.transform).toContain('var(--ig-expand-offset-x, 12px)');
    expect(button.style.transform).toContain('var(--ig-expand-offset-y, -12px)');
    expect(affordance.getLastPosition()).toEqual({ x: 150, y: 200 });
  });

  it('click on the button fires the registered onExpand handler with the current node id', () => {
    const handler = vi.fn();
    affordance.setOnExpand(handler);
    affordance.show('node-7');
    const button = affordance.getButton()!;
    button.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('node-7');
  });

  it('click while hidden is a no-op (no node id cached)', () => {
    const handler = vi.fn();
    affordance.setOnExpand(handler);
    // Don't call show — currentNodeId stays null.
    const button = affordance.getButton()!;
    button.click();
    expect(handler).not.toHaveBeenCalled();
  });

  it('click stops propagation so the canvas-level click does not also fire', () => {
    const canvasClick = vi.fn();
    container.addEventListener('click', canvasClick);
    affordance.setOnExpand(() => undefined);
    affordance.show('a');
    const button = affordance.getButton()!;
    button.click();
    // Bubbling is stopped by the affordance's click handler.
    expect(canvasClick).not.toHaveBeenCalled();
    container.removeEventListener('click', canvasClick);
  });

  it('overlay has pointer-events: none so the canvas raycast underneath is unblocked', () => {
    const overlay = affordance.getOverlay()!;
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('detach removes the overlay + button from the DOM and clears state', () => {
    affordance.show('a');
    affordance.updatePosition(50, 60);
    affordance.detach();
    expect(container.querySelector('.ig-affordance-overlay')).toBeNull();
    expect(container.querySelector('.ig-expand-affordance')).toBeNull();
    expect(affordance.getCurrentNodeId()).toBeNull();
    expect(affordance.getLastPosition()).toEqual({ x: 0, y: 0 });
    expect(affordance.getButton()).toBeNull();
    expect(affordance.getOverlay()).toBeNull();
  });

  it('detach removes the click listener so a re-attached node click does not double-fire', () => {
    const handler = vi.fn();
    affordance.setOnExpand(handler);
    affordance.show('a');
    const oldButton = affordance.getButton()!;
    affordance.detach();
    // Manually click the orphaned node — the listener should be gone.
    oldButton.click();
    expect(handler).not.toHaveBeenCalled();
  });

  it('attach is idempotent — a second attach without detach does not duplicate the overlay', () => {
    // First attach happened in beforeEach. Try a second attach.
    affordance.attach(container);
    expect(container.querySelectorAll('.ig-affordance-overlay').length).toBe(1);
    expect(container.querySelectorAll('.ig-expand-affordance').length).toBe(1);
  });
});
