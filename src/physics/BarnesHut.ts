import type { Vector3 } from '../types.js';

interface OctreeNode {
  center: Vector3;
  size: number;
  mass: number;
  centerOfMass: Vector3;
  bodies: Array<{ position: Vector3; mass: number; index: number }>;
  children: (OctreeNode | null)[];
  isLeaf: boolean;
}

export class BarnesHut {
  private readonly theta: number;

  constructor(theta: number = 0.5) {
    this.theta = theta;
  }

  buildTree(positions: Vector3[], masses: number[]): OctreeNode {
    const bounds = this.computeBounds(positions);
    const root = this.createNode(bounds.center, bounds.size);

    for (let i = 0; i < positions.length; i++) {
      this.insert(root, { position: positions[i], mass: masses[i], index: i });
    }

    return root;
  }

  computeForce(tree: OctreeNode, position: Vector3, repulsionStrength: number): Vector3 {
    const force: Vector3 = { x: 0, y: 0, z: 0 };
    this.computeForceRecursive(tree, position, repulsionStrength, force);
    return force;
  }

  private computeForceRecursive(
    node: OctreeNode,
    position: Vector3,
    repulsionStrength: number,
    force: Vector3,
  ): void {
    if (node.mass === 0) return;

    const dx = node.centerOfMass.x - position.x;
    const dy = node.centerOfMass.y - position.y;
    const dz = node.centerOfMass.z - position.z;
    const distSq = dx * dx + dy * dy + dz * dz + 0.001;
    const dist = Math.sqrt(distSq);

    if (node.isLeaf || node.size / dist < this.theta) {
      const f = (-repulsionStrength * node.mass) / distSq;
      force.x += f * (dx / dist);
      force.y += f * (dy / dist);
      force.z += f * (dz / dist);
      return;
    }

    for (const child of node.children) {
      if (child) {
        this.computeForceRecursive(child, position, repulsionStrength, force);
      }
    }
  }

  private computeBounds(positions: Vector3[]): { center: Vector3; size: number } {
    if (positions.length === 0) {
      return { center: { x: 0, y: 0, z: 0 }, size: 1 };
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const p of positions) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }

    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
    return {
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
      size,
    };
  }

  private createNode(center: Vector3, size: number): OctreeNode {
    return {
      center,
      size,
      mass: 0,
      centerOfMass: { x: 0, y: 0, z: 0 },
      bodies: [],
      children: Array(8).fill(null),
      isLeaf: true,
    };
  }

  private insert(
    node: OctreeNode,
    body: { position: Vector3; mass: number; index: number },
  ): void {
    if (node.mass === 0) {
      node.bodies.push(body);
      node.mass = body.mass;
      node.centerOfMass = { ...body.position };
      return;
    }

    node.centerOfMass.x = (node.centerOfMass.x * node.mass + body.position.x * body.mass) / (node.mass + body.mass);
    node.centerOfMass.y = (node.centerOfMass.y * node.mass + body.position.y * body.mass) / (node.mass + body.mass);
    node.centerOfMass.z = (node.centerOfMass.z * node.mass + body.position.z * body.mass) / (node.mass + body.mass);
    node.mass += body.mass;

    if (node.isLeaf && node.bodies.length === 1) {
      node.isLeaf = false;
      const existing = node.bodies[0];
      node.bodies = [];
      this.insertIntoChild(node, existing);
    }

    if (!node.isLeaf) {
      this.insertIntoChild(node, body);
    } else {
      node.bodies.push(body);
    }
  }

  private insertIntoChild(
    node: OctreeNode,
    body: { position: Vector3; mass: number; index: number },
  ): void {
    const octant = this.getOctant(node.center, body.position);
    if (!node.children[octant]) {
      const childSize = node.size / 2;
      const offset = childSize / 2;
      const cx = node.center.x + ((octant & 1) ? offset : -offset);
      const cy = node.center.y + ((octant & 2) ? offset : -offset);
      const cz = node.center.z + ((octant & 4) ? offset : -offset);
      node.children[octant] = this.createNode({ x: cx, y: cy, z: cz }, childSize);
    }
    this.insert(node.children[octant]!, body);
  }

  private getOctant(center: Vector3, position: Vector3): number {
    let octant = 0;
    if (position.x >= center.x) octant |= 1;
    if (position.y >= center.y) octant |= 2;
    if (position.z >= center.z) octant |= 4;
    return octant;
  }
}
