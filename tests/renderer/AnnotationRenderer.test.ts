import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnnotationRenderer } from '../../src/renderer/AnnotationRenderer.js';

describe('AnnotationRenderer', () => {
  let container: HTMLDivElement;
  let renderer: AnnotationRenderer;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    renderer = new AnnotationRenderer();
    renderer.attach(container);
  });

  afterEach(() => {
    renderer.detach();
    container.remove();
  });

  it('appends an absolutely-positioned div per annotation', () => {
    renderer.annotate('a', 'first');
    const els = container.querySelectorAll<HTMLDivElement>('.ig-annotation');
    expect(els.length).toBe(1);
    expect(els[0].textContent).toBe('first');
    expect(els[0].style.position).toBe('absolute');
    expect(els[0].dataset.nodeId).toBe('a');
  });

  it('supports multiple annotations on the same node', () => {
    renderer.annotate('a', 'one');
    renderer.annotate('a', 'two');
    const els = container.querySelectorAll('.ig-annotation');
    expect(els.length).toBe(2);
    expect(renderer.getAnnotationsFor('a')).toEqual(['one', 'two']);
  });

  it('tracks the count across nodes', () => {
    renderer.annotate('a', 'one');
    renderer.annotate('b', 'two');
    expect(renderer.getCount()).toBe(2);
    expect(renderer.getAnnotatedNodeIds().sort()).toEqual(['a', 'b']);
  });

  it('clearAnnotations(id) drops one node', () => {
    renderer.annotate('a', 'first');
    renderer.annotate('b', 'second');
    renderer.clearAnnotations('a');
    expect(renderer.getCount()).toBe(1);
    expect(renderer.getAnnotatedNodeIds()).toEqual(['b']);
    expect(container.querySelectorAll('.ig-annotation').length).toBe(1);
  });

  it('clearAnnotations() with no id drops every node', () => {
    renderer.annotate('a', 'first');
    renderer.annotate('b', 'second');
    renderer.clearAnnotations();
    expect(renderer.getCount()).toBe(0);
    expect(container.querySelectorAll('.ig-annotation').length).toBe(0);
  });

  it('updatePosition writes a translate transform', () => {
    renderer.annotate('a', 'hello');
    renderer.updatePosition('a', 100, 200);
    const el = container.querySelector<HTMLDivElement>('.ig-annotation')!;
    expect(el.style.transform).toBe('translate(100px, 200px)');
  });

  it('replays the latest known position on a freshly-added annotation', () => {
    renderer.updatePosition('a', 50, 60);
    renderer.annotate('a', 'late');
    const el = container.querySelector<HTMLDivElement>('.ig-annotation')!;
    expect(el.style.transform).toBe('translate(50px, 60px)');
  });

  it('updatePosition is a no-op for nodes without annotations', () => {
    expect(() => renderer.updatePosition('ghost', 1, 2)).not.toThrow();
  });

  it('annotate before attach is a no-op (no element added)', () => {
    const r = new AnnotationRenderer();
    r.annotate('a', 'pre-attach');
    // Re-attach to a fresh container to verify no element was orphaned in the global doc.
    const c = document.createElement('div');
    document.body.appendChild(c);
    r.attach(c);
    // The annotate above happened before attach, so nothing was inserted.
    expect(c.querySelector('.ig-annotation')).toBeNull();
    r.detach();
    c.remove();
  });

  it('detach clears annotations and the container reference', () => {
    renderer.annotate('a', 'hi');
    renderer.detach();
    expect(container.querySelector('.ig-annotation')).toBeNull();
    expect(renderer.getCount()).toBe(0);
  });
});
