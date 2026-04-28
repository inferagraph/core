import * as THREE from 'three';

export class Raycaster {
  private enabled = true;
  /**
   * The active camera. Accepts both perspective (graph view) and
   * orthographic (tree view) cameras — `THREE.Camera` is the common
   * supertype that `THREE.Raycaster.setFromCamera` accepts.
   */
  private camera: THREE.Camera | null = null;
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

  setCamera(camera: THREE.Camera): void {
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

    // `recursive=true` so children of a Group (e.g. tree-mode card groups
    // that bundle a fill plane + border line per node) are hit-tested.
    const intersections = this.threeRaycaster.intersectObjects(this.objects, true);

    if (intersections.length === 0) return null;

    const hit = intersections[0];
    // For InstancedMesh, instanceId maps to node index.
    if (hit.instanceId !== undefined && hit.instanceId < this.nodeIds.length) {
      return this.nodeIds[hit.instanceId];
    }
    // Walk up the parent chain to find a node id stamped in `userData`.
    // Tree-mode card meshes use this path because they render one
    // Object3D per node rather than instances of a shared geometry.
    let cursor: THREE.Object3D | null = hit.object;
    while (cursor) {
      const id = cursor.userData?.nodeId;
      if (typeof id === 'string') return id;
      cursor = cursor.parent;
    }

    return null;
  }
}
