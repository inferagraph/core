import type { NodeId } from '../types.js';

export interface MinimapConfig {
  width?: number;
  height?: number;
  padding?: number;
  nodeRadius?: number;
  nodeColor?: string;
  viewportColor?: string;
  viewportBorderColor?: string;
  backgroundColor?: string;
}

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Minimap {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private nodePositions = new Map<NodeId, { x: number; y: number }>();
  private viewport: ViewportRect = { x: 0, y: 0, width: 1, height: 1 };

  private readonly config: Required<MinimapConfig>;
  private onNavigate?: (x: number, y: number) => void;

  private worldBounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };

  constructor(config: MinimapConfig = {}) {
    this.config = {
      width: config.width ?? 200,
      height: config.height ?? 150,
      padding: config.padding ?? 10,
      nodeRadius: config.nodeRadius ?? 3,
      nodeColor: config.nodeColor ?? '#4a9eff',
      viewportColor: config.viewportColor ?? 'rgba(255, 107, 53, 0.3)',
      viewportBorderColor: config.viewportBorderColor ?? '#ff6b35',
      backgroundColor: config.backgroundColor ?? 'rgba(0,0,0,0.05)',
    };
  }

  /** Attach minimap to a container element */
  attach(container: HTMLElement): void {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.config.width;
    this.canvas.height = this.config.height;
    this.canvas.style.cssText = `
      position: absolute;
      bottom: 10px;
      left: 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      cursor: pointer;
      z-index: 10;
    `;
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);

    this.canvas.addEventListener('click', this.handleClick);
  }

  /** Detach minimap */
  detach(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('click', this.handleClick);
      this.canvas.remove();
    }
    this.canvas = null;
    this.ctx = null;
    this.container = null;
  }

  /** Check if attached */
  isAttached(): boolean {
    return this.container !== null;
  }

  /** Set the callback for navigation clicks */
  setOnNavigate(callback: (x: number, y: number) => void): void {
    this.onNavigate = callback;
  }

  /** Update node positions (2D projected positions) */
  updatePositions(positions: Map<NodeId, { x: number; y: number }>): void {
    this.nodePositions = new Map(positions);
    this.computeWorldBounds();
    this.render();
  }

  /** Update viewport rectangle (world coordinates) */
  updateViewport(viewport: ViewportRect): void {
    this.viewport = { ...viewport };
    this.render();
  }

  /** Get the canvas element */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  /** Get current node count */
  getNodeCount(): number {
    return this.nodePositions.size;
  }

  /** Render the minimap */
  render(): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const { width, height, padding } = this.config;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = this.config.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    if (this.nodePositions.size === 0) return;

    const drawWidth = width - padding * 2;
    const drawHeight = height - padding * 2;

    // Draw nodes
    ctx.fillStyle = this.config.nodeColor;
    for (const [, pos] of this.nodePositions) {
      const mx = this.worldToMinimapX(pos.x, drawWidth, padding);
      const my = this.worldToMinimapY(pos.y, drawHeight, padding);
      ctx.beginPath();
      ctx.arc(mx, my, this.config.nodeRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw viewport rectangle
    const vx = this.worldToMinimapX(this.viewport.x, drawWidth, padding);
    const vy = this.worldToMinimapY(this.viewport.y, drawHeight, padding);
    const vw =
      (this.viewport.width / (this.worldBounds.maxX - this.worldBounds.minX || 1)) * drawWidth;
    const vh =
      (this.viewport.height / (this.worldBounds.maxY - this.worldBounds.minY || 1)) * drawHeight;

    ctx.fillStyle = this.config.viewportColor;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeStyle = this.config.viewportBorderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vw, vh);
  }

  private computeWorldBounds(): void {
    if (this.nodePositions.size === 0) return;

    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

    for (const [, pos] of this.nodePositions) {
      if (pos.x < minX) minX = pos.x;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.y > maxY) maxY = pos.y;
    }

    // Add margin
    const marginX = (maxX - minX) * 0.1 || 10;
    const marginY = (maxY - minY) * 0.1 || 10;

    this.worldBounds = {
      minX: minX - marginX,
      maxX: maxX + marginX,
      minY: minY - marginY,
      maxY: maxY + marginY,
    };
  }

  private worldToMinimapX(x: number, drawWidth: number, padding: number): number {
    const range = this.worldBounds.maxX - this.worldBounds.minX || 1;
    return padding + ((x - this.worldBounds.minX) / range) * drawWidth;
  }

  private worldToMinimapY(y: number, drawHeight: number, padding: number): number {
    const range = this.worldBounds.maxY - this.worldBounds.minY || 1;
    return padding + ((y - this.worldBounds.minY) / range) * drawHeight;
  }

  private minimapToWorldX(mx: number): number {
    const { padding, width } = this.config;
    const drawWidth = width - padding * 2;
    const range = this.worldBounds.maxX - this.worldBounds.minX || 1;
    return this.worldBounds.minX + ((mx - padding) / drawWidth) * range;
  }

  private minimapToWorldY(my: number): number {
    const { padding, height } = this.config;
    const drawHeight = height - padding * 2;
    const range = this.worldBounds.maxY - this.worldBounds.minY || 1;
    return this.worldBounds.minY + ((my - padding) / drawHeight) * range;
  }

  private handleClick = (event: MouseEvent): void => {
    if (!this.canvas || !this.onNavigate) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;

    const worldX = this.minimapToWorldX(mx);
    const worldY = this.minimapToWorldY(my);

    this.onNavigate(worldX, worldY);
  };
}
