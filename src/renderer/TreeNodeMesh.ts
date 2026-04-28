import * as THREE from 'three';
import type { Vector3 } from '../types.js';

/**
 * Per-node "card" mesh used by the tree view. Each node renders as a
 * rounded-rectangle plane (translucent dark fill) with a coloured outline
 * matching the node's resolved colour, plus a centred CanvasTexture-backed
 * text plane that displays the node's title. A single `THREE.Group`
 * aggregates fill + outline + label so the SceneController can swap one
 * Object3D per node into the scene.
 *
 * Why not InstancedMesh? Because each card needs a per-instance border
 * colour, and instancing-with-vertex-colour would require a custom
 * shader. With typical family-tree sizes (≤ ~200 nodes) the overhead of
 * one mesh per node is well below 1ms per frame and dramatically simpler
 * to maintain. Instancing is reserved for the graph view's sphere mesh
 * which routinely hits 1000+ nodes.
 *
 * Why CanvasTexture for labels (instead of HTML overlays)? The HTML
 * `LabelRenderer` projects through whichever camera the renderer holds.
 * Switching to the orthographic tree camera while still iterating the
 * graph-mode label set caused every label to collapse to (0,0). Painting
 * the title directly into the card mesh removes the cross-system
 * coupling entirely and makes the tree view self-contained.
 *
 * Hit-testing: each Group stamps its `userData.nodeId` so the
 * {@link Raycaster} can resolve a hit back to the originating node id.
 */
export class TreeNodeMesh {
  /** Card size (world units). Mirrors the SVG mockup's 90×32 proportions. */
  static readonly DEFAULT_WIDTH = 90;
  static readonly DEFAULT_HEIGHT = 32;
  static readonly DEFAULT_RADIUS = 8;

  /** Translucent dark fill — `rgba(30,30,46,0.8)` from the SVG mockup. */
  static readonly DEFAULT_FILL_COLOR = '#1e1e2e';
  static readonly DEFAULT_FILL_OPACITY = 0.8;

  /** Default label colour — zinc-200, matches the marketing-site spec. */
  static readonly DEFAULT_LABEL_COLOR = '#e4e4e7';

  /**
   * Pixel density for the label canvas. The card is sized in world units
   * but the canvas it textures is rasterised at a fixed pixels-per-unit so
   * the resulting glyphs stay crisp at the orthographic camera's typical
   * zoom range. Roughly matches a 1.5× DPR-adjusted CSS pixel.
   */
  static readonly LABEL_PIXELS_PER_UNIT = 6;

  private readonly width: number;
  private readonly height: number;
  private readonly radius: number;
  private readonly fillColor: string;
  private readonly fillOpacity: number;
  private readonly labelColor: string;

  /**
   * Group of per-node card objects. Each child is a `THREE.Group`
   * containing a fill mesh + outline line, with `userData.nodeId` stamped
   * on the parent group. The outer group is what gets added to the scene.
   */
  private root: THREE.Group | null = null;
  private cards = new Map<string, TreeCardEntry>();

  constructor(options?: {
    width?: number;
    height?: number;
    radius?: number;
    fillColor?: string;
    fillOpacity?: number;
    labelColor?: string;
  }) {
    this.width = options?.width ?? TreeNodeMesh.DEFAULT_WIDTH;
    this.height = options?.height ?? TreeNodeMesh.DEFAULT_HEIGHT;
    this.radius = options?.radius ?? TreeNodeMesh.DEFAULT_RADIUS;
    this.fillColor = options?.fillColor ?? TreeNodeMesh.DEFAULT_FILL_COLOR;
    this.fillOpacity = options?.fillOpacity ?? TreeNodeMesh.DEFAULT_FILL_OPACITY;
    this.labelColor = options?.labelColor ?? TreeNodeMesh.DEFAULT_LABEL_COLOR;
  }

  /**
   * (Re)build the card group from scratch. Disposes any prior geometry
   * so successive `build` calls are safe.
   *
   * Each entry may carry an optional `label` — when present, a
   * CanvasTexture-backed plane is added inside the card to display the
   * label. Entries without a label render as bare cards (back-compat with
   * pre-0.1.16 callers).
   */
  build(
    entries: Array<{ id: string; position: Vector3; color: string; label?: string }>,
  ): void {
    this.dispose();

    const root = new THREE.Group();
    root.name = 'TreeNodeMesh.root';

    for (const entry of entries) {
      const card = this.createCard(entry.id, entry.color, entry.label);
      card.group.position.set(entry.position.x, entry.position.y, entry.position.z);
      root.add(card.group);
      this.cards.set(entry.id, card);
    }

    this.root = root;
  }

  /**
   * Update an existing card's position + outline colour. Cheap — reuses
   * the existing geometry.
   */
  updateCard(id: string, position: Vector3, color?: string): void {
    const card = this.cards.get(id);
    if (!card) return;
    card.group.position.set(position.x, position.y, position.z);
    if (color) {
      card.outlineMaterial.color.set(color);
    }
  }

  /**
   * Get the size of each card in world units. Consumers (SceneController)
   * use this to compute orthogonal-connector endpoints (top-edge,
   * bottom-edge midpoints).
   */
  getCardSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** The root Group registered with the WebGL scene. */
  getMesh(): THREE.Group | null {
    return this.root;
  }

  /** Raycast targets — the per-card groups, NOT the outer root. */
  getRaycastTargets(): THREE.Object3D[] {
    return Array.from(this.cards.values()).map((c) => c.group);
  }

  dispose(): void {
    for (const card of this.cards.values()) {
      card.fillGeometry.dispose();
      card.fillMaterial.dispose();
      card.outlineGeometry.dispose();
      card.outlineMaterial.dispose();
      card.labelGeometry?.dispose();
      card.labelMaterial?.dispose();
      card.labelTexture?.dispose();
    }
    this.cards.clear();
    this.root = null;
  }

  // --- internals ---

  private createCard(
    nodeId: string,
    outlineColor: string,
    label?: string,
  ): TreeCardEntry {
    const w = this.width;
    const h = this.height;
    const r = Math.min(this.radius, w / 2, h / 2);

    // ---- Filled rounded rect via THREE.Shape ----
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);

    const fillGeometry = new THREE.ShapeGeometry(shape);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: this.fillColor,
      transparent: true,
      opacity: this.fillOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    // Render fill slightly behind outlines from the camera's POV.
    fillMesh.renderOrder = 0;

    // ---- Outline as a Line loop along the same shape ----
    const outlinePoints = shape.getPoints(24);
    const outlineGeometry = new THREE.BufferGeometry().setFromPoints(
      outlinePoints.map((p) => new THREE.Vector3(p.x, p.y, 0.01)),
    );
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: outlineColor,
      transparent: true,
      opacity: 1.0,
    });
    const outlineMesh = new THREE.LineLoop(outlineGeometry, outlineMaterial);
    outlineMesh.renderOrder = 1;

    const group = new THREE.Group();
    group.name = `TreeNodeMesh.card[${nodeId}]`;
    group.userData.nodeId = nodeId;
    group.add(fillMesh);
    group.add(outlineMesh);

    // ---- Optional label plane ----
    let labelGeometry: THREE.PlaneGeometry | undefined;
    let labelMaterial: THREE.MeshBasicMaterial | undefined;
    let labelTexture: THREE.CanvasTexture | undefined;
    if (label && label.length > 0) {
      const built = this.buildLabelPlane(label);
      if (built) {
        labelGeometry = built.geometry;
        labelMaterial = built.material;
        labelTexture = built.texture;
        const labelMesh = new THREE.Mesh(built.geometry, built.material);
        // Sit above the outline (z=0.01) so the text isn't clipped.
        labelMesh.position.set(0, 0, 0.02);
        labelMesh.renderOrder = 2;
        group.add(labelMesh);
      }
    }

    return {
      group,
      fillGeometry,
      fillMaterial,
      outlineGeometry,
      outlineMaterial,
      labelGeometry,
      labelMaterial,
      labelTexture,
    };
  }

  /**
   * Rasterise the supplied text into an offscreen canvas, upload it as a
   * `THREE.CanvasTexture`, and return a transparent plane mesh sized to
   * fill the card. Returns null in environments where 2D canvas isn't
   * available (e.g. the headless test mock for `three`).
   */
  private buildLabelPlane(text: string): {
    geometry: THREE.PlaneGeometry;
    material: THREE.MeshBasicMaterial;
    texture: THREE.CanvasTexture;
  } | null {
    const ppu = TreeNodeMesh.LABEL_PIXELS_PER_UNIT;
    const canvasW = Math.max(1, Math.round(this.width * ppu));
    const canvasH = Math.max(1, Math.round(this.height * ppu));

    // `document.createElement` exists in jsdom; in non-DOM contexts the
    // texture path is skipped entirely.
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Transparent background — the rounded-rect fill mesh sits behind us.
    ctx.clearRect(0, 0, canvasW, canvasH);
    // Font sized to ~35% of card height. 50% pushed long biblical names
    // (Methuselah, Mephibosheth, Mahalalel) right up against the card
    // edges; 35% leaves comfortable horizontal padding while still being
    // legible at the orthographic camera's typical zoom.
    const fontPx = Math.max(8, Math.round(this.height * ppu * 0.35));
    ctx.font = `bold ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.labelColor;
    ctx.fillText(text, canvasW / 2, canvasH / 2);

    const texture = new THREE.CanvasTexture(canvas);
    // Crisper text under the orthographic camera.
    if ('anisotropy' in (texture as unknown as Record<string, unknown>)) {
      (texture as unknown as { anisotropy: number }).anisotropy = 4;
    }
    texture.needsUpdate = true;

    const geometry = new THREE.PlaneGeometry(this.width, this.height);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });

    return { geometry, material, texture };
  }
}

interface TreeCardEntry {
  group: THREE.Group;
  fillGeometry: THREE.BufferGeometry;
  fillMaterial: THREE.MeshBasicMaterial;
  outlineGeometry: THREE.BufferGeometry;
  outlineMaterial: THREE.LineBasicMaterial;
  labelGeometry?: THREE.PlaneGeometry;
  labelMaterial?: THREE.MeshBasicMaterial;
  labelTexture?: THREE.CanvasTexture;
}
