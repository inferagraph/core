import type { NodeData, NodeRenderFn, NodeRenderState } from '../types.js';

export class CustomNodeRenderer {
  private container: HTMLElement | null = null;
  private nodes = new Map<string, { element: HTMLElement; cleanup?: () => void }>();

  attach(parent: HTMLElement): void {
    const el = document.createElement('div');
    el.className = 'ig-custom-node-container';
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.pointerEvents = 'none';
    el.style.overflow = 'hidden';
    parent.appendChild(el);
    this.container = el;
  }

  addNode(id: string, node: NodeData, state: NodeRenderState, renderNode: NodeRenderFn): void {
    if (!this.container) return;
    const el = document.createElement('div');
    el.className = 'ig-custom-node';
    el.dataset.nodeId = id;
    el.style.position = 'absolute';
    el.style.pointerEvents = 'auto';
    this.container.appendChild(el);
    const cleanup = renderNode(el, node, state);
    this.nodes.set(id, { element: el, cleanup: cleanup || undefined });
  }

  updateNode(id: string, node: NodeData, state: NodeRenderState, renderNode: NodeRenderFn): void {
    const entry = this.nodes.get(id);
    if (!entry) return;
    if (entry.cleanup) {
      entry.cleanup();
    }
    entry.element.innerHTML = '';
    const cleanup = renderNode(entry.element, node, state);
    entry.cleanup = cleanup || undefined;
  }

  removeNode(id: string): void {
    const entry = this.nodes.get(id);
    if (!entry) return;
    if (entry.cleanup) {
      entry.cleanup();
    }
    entry.element.remove();
    this.nodes.delete(id);
  }

  updatePosition(id: string, x: number, y: number): void {
    const entry = this.nodes.get(id);
    if (!entry) return;
    entry.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  clear(): void {
    for (const [, entry] of this.nodes) {
      if (entry.cleanup) {
        entry.cleanup();
      }
      entry.element.remove();
    }
    this.nodes.clear();
  }

  detach(): void {
    this.clear();
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}
