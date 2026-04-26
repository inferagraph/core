import * as THREE from 'three';
import type { Vector3, NodeStyle, NodeRenderConfig, NodeRenderFn } from '../types.js';

export class NodeMesh {
  private position: Vector3 = { x: 0, y: 0, z: 0 };
  private color: string = '#4a9eff';
  private radius: number = 5;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.MeshPhongMaterial | null = null;

  private readonly style: NodeStyle;
  private readonly cardWidth: number;
  private readonly cardHeight: number;
  private readonly renderNode?: NodeRenderFn;
  private readonly _component?: unknown;
  private readonly hitboxRadius: number;

  constructor(config?: NodeRenderConfig) {
    this.renderNode = config?.renderNode;
    this._component = config?.component;
    this.hitboxRadius = config?.hitboxRadius ?? 20;

    if (!config?.style && (config?.renderNode || config?.component)) {
      this.style = 'custom';
    } else {
      this.style = config?.style ?? 'dot';
    }

    this.cardWidth = config?.cardWidth ?? 80;
    this.cardHeight = config?.cardHeight ?? 36;
  }

  get nodeStyle(): NodeStyle {
    return this.style;
  }

  getCardWidth(): number {
    return this.cardWidth;
  }

  getCardHeight(): number {
    return this.cardHeight;
  }

  setPosition(position: Vector3): void {
    this.position = { ...position };
  }

  getPosition(): Vector3 {
    return this.position;
  }

  setColor(color: string): void {
    this.color = color;
  }

  getColor(): string {
    return this.color;
  }

  setRadius(radius: number): void {
    this.radius = radius;
  }

  getRadius(): number {
    return this.radius;
  }

  createInstancedMesh(count: number): void {
    this.dispose();

    switch (this.style) {
      case 'card':
        this.geometry = this.createRoundedRectGeometry(this.cardWidth, this.cardHeight, 6);
        this.material = new THREE.MeshPhongMaterial({ color: this.color });
        break;
      case 'custom': {
        this.geometry = new THREE.SphereGeometry(1, 8, 8);
        this.material = new THREE.MeshPhongMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        break;
      }
      default:
        this.geometry = new THREE.SphereGeometry(1, 16, 16);
        this.material = new THREE.MeshPhongMaterial({ color: this.color });
        break;
    }
    this.instancedMesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.instancedMesh.count = count;
  }

  updateInstance(index: number, position: Vector3, color?: string, scale?: number): void {
    if (!this.instancedMesh) return;

    const matrix = new THREE.Matrix4();

    let scaleVec: THREE.Vector3;
    if (this.style === 'card') {
      // For cards, scale uniformly by 1 (geometry already has correct dimensions)
      const s = scale ?? 1;
      scaleVec = new THREE.Vector3(s, s, s);
    } else if (this.style === 'custom') {
      const scaleVal = this.hitboxRadius;
      scaleVec = new THREE.Vector3(scaleVal, scaleVal, scaleVal);
    } else {
      const scaleVal = scale ?? this.radius;
      scaleVec = new THREE.Vector3(scaleVal, scaleVal, scaleVal);
    }

    const posVec = new THREE.Vector3(position.x, position.y, position.z);
    const quaternion = new THREE.Quaternion();

    matrix.compose(posVec, quaternion, scaleVec);
    this.instancedMesh.setMatrixAt(index, matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    if (color) {
      const threeColor = new THREE.Color(color);
      this.instancedMesh.setColorAt(index, threeColor);
      if (this.instancedMesh.instanceColor) {
        this.instancedMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  getMesh(): THREE.InstancedMesh | null {
    return this.instancedMesh;
  }

  getRenderNode(): NodeRenderFn | undefined {
    return this.renderNode;
  }

  getComponent(): unknown {
    return this._component;
  }

  getHitboxRadius(): number {
    return this.hitboxRadius;
  }

  dispose(): void {
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    this.instancedMesh = null;
  }

  /** Create a rounded rectangle geometry using THREE.Shape */
  private createRoundedRectGeometry(width: number, height: number, radius: number): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    const w = width / 2;
    const h = height / 2;
    const r = Math.min(radius, w, h);

    shape.moveTo(-w + r, -h);
    shape.lineTo(w - r, -h);
    shape.quadraticCurveTo(w, -h, w, -h + r);
    shape.lineTo(w, h - r);
    shape.quadraticCurveTo(w, h, w - r, h);
    shape.lineTo(-w + r, h);
    shape.quadraticCurveTo(-w, h, -w, h - r);
    shape.lineTo(-w, -h + r);
    shape.quadraticCurveTo(-w, -h, -w + r, -h);

    return new THREE.ShapeGeometry(shape);
  }
}
