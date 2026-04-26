import * as THREE from 'three';

export class Raycaster {
  private enabled = true;
  private camera: THREE.PerspectiveCamera | null = null;
  private objects: THREE.Object3D[] = [];
  private nodeIds: string[] = [];
  private threeRaycaster = new THREE.Raycaster();

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  setObjects(objects: THREE.Object3D[]): void {
    this.objects = objects;
  }

  setNodeIds(ids: string[]): void {
    this.nodeIds = ids;
  }

  hitTest(x: number, y: number, width?: number, height?: number): string | null {
    if (!this.enabled) return null;
    if (!this.camera) return null;
    if (this.objects.length === 0) return null;

    // If width and height are provided, convert screen coords to NDC
    const ndcX = width ? (x / width) * 2 - 1 : x;
    const ndcY = height ? -(y / height) * 2 + 1 : y;

    const mouse = new THREE.Vector2(ndcX, ndcY);
    this.threeRaycaster.setFromCamera(mouse, this.camera);

    const intersections = this.threeRaycaster.intersectObjects(this.objects, false);

    if (intersections.length === 0) return null;

    const hit = intersections[0];
    // For InstancedMesh, instanceId maps to node index
    if (hit.instanceId !== undefined && hit.instanceId < this.nodeIds.length) {
      return this.nodeIds[hit.instanceId];
    }

    return null;
  }
}
