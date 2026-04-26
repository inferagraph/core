import type { NodeId } from '../types.js';
import { GraphStore } from '../store/GraphStore.js';

export interface ExportOptions {
  /** Only export selected nodes (requires selectedNodeIds) */
  selectedOnly?: boolean;
  /** Node IDs to export when selectedOnly is true */
  selectedNodeIds?: Set<NodeId>;
  /** Include metadata in JSON export */
  includeMetadata?: boolean;
  /** Resolution scale for PNG export */
  scale?: number;
  /** Width for SVG/PNG export */
  width?: number;
  /** Height for SVG/PNG export */
  height?: number;
}

export interface NodePosition {
  id: NodeId;
  x: number;
  y: number;
  color?: string;
  radius?: number;
  label?: string;
}

export interface EdgePosition {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  color?: string;
}

export class ExportEngine {
  constructor(private readonly store: GraphStore) {}

  /** Export graph as JSON string */
  exportJSON(options: ExportOptions = {}): string {
    if (options.selectedOnly && options.selectedNodeIds) {
      const selectedIds = Array.from(options.selectedNodeIds);
      const serialized = this.store.toJSON();
      const selectedSet = new Set(selectedIds);

      return JSON.stringify({
        ...serialized,
        nodes: serialized.nodes.filter(n => selectedSet.has(n.id)),
        edges: serialized.edges.filter(e => selectedSet.has(e.sourceId) && selectedSet.has(e.targetId)),
        metadata: options.includeMetadata !== false ? {
          ...serialized.metadata,
          nodeCount: selectedIds.length,
          exportedAt: new Date().toISOString(),
        } : undefined,
      }, null, 2);
    }

    const serialized = this.store.toJSON();
    if (options.includeMetadata === false) {
      const { metadata: _, ...rest } = serialized;
      return JSON.stringify(rest, null, 2);
    }
    return JSON.stringify(serialized, null, 2);
  }

  /** Export graph as SVG string */
  exportSVG(
    nodes: NodePosition[],
    edges: EdgePosition[],
    options: ExportOptions = {},
  ): string {
    const width = options.width ?? 800;
    const height = options.height ?? 600;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`;
    svg += `  <rect width="${width}" height="${height}" fill="white"/>\n`;

    // Draw edges
    svg += '  <g class="edges">\n';
    for (const edge of edges) {
      const color = edge.color ?? '#cccccc';
      svg += `    <line x1="${edge.sourceX}" y1="${edge.sourceY}" x2="${edge.targetX}" y2="${edge.targetY}" stroke="${color}" stroke-width="1"/>\n`;
    }
    svg += '  </g>\n';

    // Draw nodes
    svg += '  <g class="nodes">\n';
    for (const node of nodes) {
      const color = node.color ?? '#4a9eff';
      const radius = node.radius ?? 5;
      svg += `    <circle cx="${node.x}" cy="${node.y}" r="${radius}" fill="${color}"/>\n`;
      if (node.label) {
        svg += `    <text x="${node.x}" y="${node.y + radius + 12}" text-anchor="middle" font-size="10" fill="#333">${this.escapeXml(node.label)}</text>\n`;
      }
    }
    svg += '  </g>\n';

    svg += '</svg>';
    return svg;
  }

  /** Export as PNG data URL from a canvas element.
   * In a browser: pass renderer.domElement (the canvas).
   * Returns a data URL string (data:image/png;base64,...).
   */
  exportPNG(canvas: HTMLCanvasElement, options: ExportOptions = {}): string {
    const scale = options.scale ?? 1;

    if (scale !== 1) {
      // Create a scaled canvas
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = canvas.width * scale;
      scaledCanvas.height = canvas.height * scale;
      const ctx = scaledCanvas.getContext('2d');
      if (ctx) {
        ctx.scale(scale, scale);
        ctx.drawImage(canvas, 0, 0);
        return scaledCanvas.toDataURL('image/png');
      }
    }

    return canvas.toDataURL('image/png');
  }

  /** Export as PNG Blob (async). Useful for downloading. */
  async exportPNGBlob(canvas: HTMLCanvasElement, options: ExportOptions = {}): Promise<Blob> {
    const scale = options.scale ?? 1;
    let targetCanvas = canvas;

    if (scale !== 1) {
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = canvas.width * scale;
      scaledCanvas.height = canvas.height * scale;
      const ctx = scaledCanvas.getContext('2d');
      if (ctx) {
        ctx.scale(scale, scale);
        ctx.drawImage(canvas, 0, 0);
        targetCanvas = scaledCanvas;
      }
    }

    return new Promise((resolve, reject) => {
      targetCanvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create PNG blob'));
        },
        'image/png',
      );
    });
  }

  /** Helper to trigger a download in the browser */
  download(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
