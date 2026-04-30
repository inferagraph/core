import type { AnnotateHost } from './types.js';

/**
 * @implements {AnnotateHost}
 *
 * HTML-overlay renderer for callout annotations attached to graph nodes.
 *
 * Each annotation is one absolutely-positioned `div` inside the
 * SceneController's overlay container. The annotation is positioned in
 * screen space — the SceneController projects the world-space node
 * position once per frame and pushes the resulting (x, y) into
 * {@link updatePosition}.
 *
 * Multiple annotations on the same node are allowed; each call to
 * {@link annotate} appends a new callout. Hosts that want
 * single-annotation-per-node should call {@link clearAnnotations}
 * first.
 *
 * Visual styling is intentionally minimal — the host can override via
 * the `.ig-annotation` CSS class or by replacing the renderer.
 */
export class AnnotationRenderer implements AnnotateHost {
  private container: HTMLElement | null = null;
  /** nodeId → list of (entry, position-state). Multiple per node allowed. */
  private byNodeId = new Map<string, AnnotationEntry[]>();
  /** Last known screen position per node — projected by SceneController each frame. */
  private positions = new Map<string, { x: number; y: number }>();

  attach(container: HTMLElement): void {
    this.container = container;
  }

  /** Detach + clear all annotations. Safe to call repeatedly. */
  detach(): void {
    this.clearAnnotations();
    this.container = null;
  }

  annotate(nodeId: string, text: string): void {
    if (!this.container) return;
    const el = document.createElement('div');
    el.className = 'ig-annotation';
    el.dataset.nodeId = nodeId;
    el.style.position = 'absolute';
    el.style.pointerEvents = 'auto';
    // Defaults — host can override via CSS. The position transform is
    // updated each frame via `updatePosition`.
    el.style.transform = 'translate(0px, 0px)';
    el.textContent = text;
    this.container.appendChild(el);

    const list = this.byNodeId.get(nodeId) ?? [];
    list.push({ element: el, text });
    this.byNodeId.set(nodeId, list);

    // If we already have a projection for this node, apply it
    // immediately so the callout doesn't pop in at (0, 0) for one frame.
    const pos = this.positions.get(nodeId);
    if (pos) {
      el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    }
  }

  clearAnnotations(nodeId?: string): void {
    if (nodeId === undefined) {
      for (const list of this.byNodeId.values()) {
        for (const entry of list) entry.element.remove();
      }
      this.byNodeId.clear();
      this.positions.clear();
      return;
    }
    const list = this.byNodeId.get(nodeId);
    if (!list) return;
    for (const entry of list) entry.element.remove();
    this.byNodeId.delete(nodeId);
    this.positions.delete(nodeId);
  }

  /**
   * Push a fresh screen-space position for `nodeId`. Called by
   * SceneController each frame. No-op when no annotations exist for
   * the node.
   */
  updatePosition(nodeId: string, x: number, y: number): void {
    this.positions.set(nodeId, { x, y });
    const list = this.byNodeId.get(nodeId);
    if (!list) return;
    for (const entry of list) {
      entry.element.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  /** All node ids that currently have at least one annotation. */
  getAnnotatedNodeIds(): string[] {
    return Array.from(this.byNodeId.keys());
  }

  /** Number of annotations currently mounted (across all nodes). */
  getCount(): number {
    let total = 0;
    for (const list of this.byNodeId.values()) total += list.length;
    return total;
  }

  /** Annotation text(s) for a node (most recent last). */
  getAnnotationsFor(nodeId: string): string[] {
    return (this.byNodeId.get(nodeId) ?? []).map((e) => e.text);
  }
}

interface AnnotationEntry {
  element: HTMLElement;
  text: string;
}
