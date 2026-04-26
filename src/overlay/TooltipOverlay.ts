import type { NodeData, EdgeData, TooltipRenderFn, TooltipConfig } from '../types.js';

export class TooltipOverlay {
  private element: HTMLElement | null = null;
  private renderFn: TooltipRenderFn | undefined;
  private cleanup: (() => void) | undefined;

  attach(parent: HTMLElement): void {
    this.element = document.createElement('div');
    this.element.className = 'ig-tooltip';
    this.element.style.display = 'none';
    parent.appendChild(this.element);
  }

  /**
   * Set custom tooltip render config.
   */
  setRenderConfig(config: TooltipConfig): void {
    this.renderFn = config.renderTooltip;
  }

  /**
   * Show tooltip for a node. Uses custom renderer if configured,
   * otherwise shows node name/id as plain text.
   */
  showNode(node: NodeData, x: number, y: number): void {
    if (!this.element) return;
    this.clearCustom();

    if (this.renderFn) {
      const result = this.renderFn(this.element, { type: 'node', node });
      if (typeof result === 'function') this.cleanup = result;
    } else {
      const name = (node.attributes?.name as string) || node.id;
      this.element.textContent = name;
    }

    this.position(x, y);
    this.element.style.display = 'block';
  }

  /**
   * Show tooltip for an edge. Uses custom renderer if configured,
   * otherwise shows edge type or id as plain text.
   */
  showEdge(edge: EdgeData, x: number, y: number): void {
    if (!this.element) return;
    this.clearCustom();

    if (this.renderFn) {
      const result = this.renderFn(this.element, { type: 'edge', edge });
      if (typeof result === 'function') this.cleanup = result;
    } else {
      const label = (edge.attributes?.type as string) || edge.id;
      this.element.textContent = label;
    }

    this.position(x, y);
    this.element.style.display = 'block';
  }

  /**
   * Show raw content (backward compat). Always uses innerHTML.
   */
  show(content: string, x: number, y: number): void {
    if (!this.element) return;
    this.clearCustom();
    this.element.innerHTML = content;
    this.position(x, y);
    this.element.style.display = 'block';
  }

  hide(): void {
    if (this.element) {
      this.clearCustom();
      this.element.style.display = 'none';
    }
  }

  detach(): void {
    this.clearCustom();
    this.element?.remove();
    this.element = null;
  }

  private position(x: number, y: number): void {
    if (!this.element) return;
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
  }

  private clearCustom(): void {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = undefined;
    }
    if (this.element) {
      this.element.innerHTML = '';
    }
  }
}
