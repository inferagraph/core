import * as THREE from 'three';
import type { Vector3 } from '../types.js';

/**
 * Per-node "card" mesh used by the tree view. Each node renders as a
 * rounded-rectangle plane (translucent dark fill) with a coloured outline
 * matching the node's resolved colour. A single `THREE.Group` aggregates
 * fill + outline so the SceneController can swap one Object3D per node
 * into the scene.
 *
 * Why not InstancedMesh? Because each card needs a per-instance border
 * colour, and instancing-with-vertex-colour would require a custom
 * shader. With typical family-tree sizes (≤ ~200 nodes) the overhead of
 * one mesh per node is well below 1ms per frame and dramatically simpler
 * to maintain. Instancing is reserved for the graph view's sphere mesh
 * which routinely hits 1000+ nodes.
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

  private readonly width: number;
  private readonly height: number;
  private readonly radius: number;
  private readonly fillColor: string;
  private readonly fillOpacity: number;

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
  }) {
    this.width = options?.width ?? TreeNodeMesh.DEFAULT_WIDTH;
    this.height = options?.height ?? TreeNodeMesh.DEFAULT_HEIGHT;
    this.radius = options?.radius ?? TreeNodeMesh.DEFAULT_RADIUS;
    this.fillColor = options?.fillColor ?? TreeNodeMesh.DEFAULT_FILL_COLOR;
    this.fillOpacity = options?.fillOpacity ?? TreeNodeMesh.DEFAULT_FILL_OPACITY;
  }

  /**
   * (Re)build the card group from scratch. Disposes any prior geometry
   * so successive `build` calls are safe.
   */
  build(entries: Array<{ id: string; position: Vector3; color: string }>): void {
    this.dispose();

    const root = new THREE.Group();
    root.name = 'TreeNodeMesh.root';

    for (const entry of entries) {
      const card = this.createCard(entry.id, entry.color);
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
    }
    this.cards.clear();
    this.root = null;
  }

  // --- internals ---

  private createCard(nodeId: string, outlineColor: string): TreeCardEntry {
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

    return {
      group,
      fillGeometry,
      fillMaterial,
      outlineGeometry,
      outlineMaterial,
    };
  }
}

interface TreeCardEntry {
  group: THREE.Group;
  fillGeometry: THREE.BufferGeometry;
  fillMaterial: THREE.MeshBasicMaterial;
  outlineGeometry: THREE.BufferGeometry;
  outlineMaterial: THREE.LineBasicMaterial;
}
