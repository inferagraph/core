import * as THREE from 'three';
import { ThemeManager } from './ThemeManager.js';
import { NodeMesh } from './NodeMesh.js';
import { EdgeMesh } from './EdgeMesh.js';
import { CustomNodeRenderer } from './CustomNodeRenderer.js';
import type { Vector3 } from '../types.js';

export class WebGLRenderer {
  private container: HTMLElement | null = null;
  private readonly themeManager = new ThemeManager();
  private animationFrameId: number | null = null;

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private threeRenderer: THREE.WebGLRenderer | null = null;

  private customNodeRenderer: CustomNodeRenderer | null = null;

  private nodeMeshes = new Map<string, NodeMesh>();
  private edgeMeshes = new Map<string, EdgeMesh>();

  attach(container: HTMLElement): void {
    this.container = container;
    this.themeManager.attach(container);

    // Initialize Three.js scene
    this.scene = new THREE.Scene();

    const bgColor = this.themeManager.getColor('--ig-bg-color', '#1a1a2e');
    this.scene.background = new THREE.Color(bgColor);

    // Set up camera
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
    this.camera.position.set(0, 0, 200);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0x404040);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(100, 100, 100);
    this.scene.add(directionalLight);

    // Try to create Three.js WebGL renderer (may fail in jsdom/SSR)
    try {
      this.threeRenderer = new THREE.WebGLRenderer({ antialias: true });
      this.threeRenderer.setSize(width, height);
      this.threeRenderer.setPixelRatio(
        typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      );
      container.appendChild(this.threeRenderer.domElement);
    } catch {
      // WebGL not available (SSR, jsdom, etc.) — renderer remains null
      this.threeRenderer = null;
    }

    this.customNodeRenderer = new CustomNodeRenderer();
    this.customNodeRenderer.attach(container);
  }

  detach(): void {
    this.stopRenderLoop();

    // Remove all meshes from scene
    for (const [id] of this.nodeMeshes) {
      this.removeNodeMesh(id);
    }
    for (const [id] of this.edgeMeshes) {
      this.removeEdgeMesh(id);
    }

    // Dispose custom node renderer
    if (this.customNodeRenderer) {
      this.customNodeRenderer.detach();
      this.customNodeRenderer = null;
    }

    // Dispose Three.js renderer
    if (this.threeRenderer) {
      this.threeRenderer.dispose();
      if (this.threeRenderer.domElement && this.container) {
        this.container.removeChild(this.threeRenderer.domElement);
      }
      this.threeRenderer = null;
    }

    // Clear scene
    if (this.scene) {
      while (this.scene.children.length > 0) {
        this.scene.remove(this.scene.children[0]);
      }
      this.scene = null;
    }

    this.camera = null;
    this.container = null;
  }

  getContainer(): HTMLElement | null {
    return this.container;
  }

  getCustomNodeRenderer(): CustomNodeRenderer | null {
    return this.customNodeRenderer;
  }

  getThemeManager(): ThemeManager {
    return this.themeManager;
  }

  getScene(): THREE.Scene | null {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera | null {
    return this.camera;
  }

  render(): void {
    if (!this.threeRenderer || !this.scene || !this.camera) return;
    this.threeRenderer.render(this.scene, this.camera);
  }

  startRenderLoop(): void {
    if (this.animationFrameId !== null) return;

    const loop = (): void => {
      this.render();
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  addNodeMesh(id: string, mesh: NodeMesh): void {
    this.nodeMeshes.set(id, mesh);
    const threeMesh = mesh.getMesh();
    if (threeMesh && this.scene) {
      this.scene.add(threeMesh);
    }
  }

  removeNodeMesh(id: string): void {
    const mesh = this.nodeMeshes.get(id);
    if (mesh) {
      const threeMesh = mesh.getMesh();
      if (threeMesh && this.scene) {
        this.scene.remove(threeMesh);
      }
      mesh.dispose();
      this.nodeMeshes.delete(id);
    }
  }

  addEdgeMesh(id: string, mesh: EdgeMesh): void {
    this.edgeMeshes.set(id, mesh);
    const threeMesh = mesh.getMesh();
    if (threeMesh && this.scene) {
      this.scene.add(threeMesh);
    }
  }

  removeEdgeMesh(id: string): void {
    const mesh = this.edgeMeshes.get(id);
    if (mesh) {
      const threeMesh = mesh.getMesh();
      if (threeMesh && this.scene) {
        this.scene.remove(threeMesh);
      }
      mesh.dispose();
      this.edgeMeshes.delete(id);
    }
  }

  updateNodePositions(positions: Map<string, Vector3>): void {
    for (const [id, position] of positions) {
      const mesh = this.nodeMeshes.get(id);
      if (mesh) {
        mesh.setPosition(position);
      }
    }
  }

  setBackgroundColor(color: string): void {
    if (this.scene) {
      this.scene.background = new THREE.Color(color);
    }
  }

  resize(): void {
    if (!this.container) return;

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    if (this.threeRenderer) {
      this.threeRenderer.setSize(width, height);
    }
  }
}
