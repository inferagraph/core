import * as THREE from 'three';
import type { Vector3, NodeStyle, NodeRenderConfig, NodeRenderFn } from '../types.js';
import type { HighlightHost, VisibilityHost } from './types.js';

/**
 * Alpha applied to non-highlighted instances when a non-empty highlight
 * set is active. Visible enough to provide context, dim enough that the
 * highlighted set reads as the focus.
 */
const DIM_ALPHA = 0.3;

/**
 * @implements {VisibilityHost}
 * @implements {HighlightHost}
 *
 * Per-instance visibility is encoded as a custom `instanceAlpha`
 * `InstancedBufferAttribute` (itemSize=1) attached to the underlying
 * geometry. The material's fragment shader is patched via
 * `onBeforeCompile` so the final fragment alpha is multiplied by the
 * varying. Hidden nodes therefore disappear without any teardown,
 * rebuild, or layout recompute — `setVisibility` only writes to the
 * existing GPU buffer and flags it for upload on the next frame.
 *
 * Highlight reuses the same alpha buffer: a non-empty highlight set
 * drops non-matching instances to {@link DIM_ALPHA}; an empty set
 * restores baseline alpha. Visibility wins over highlight — a hidden
 * node stays at alpha 0 even if it would otherwise highlight.
 */
export class NodeMesh implements VisibilityHost, HighlightHost {
  private position: Vector3 = { x: 0, y: 0, z: 0 };
  private color: string = '#4a9eff';
  private radius: number = 5;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.MeshPhongMaterial | null = null;
  /**
   * Per-instance alpha buffer. Length === instance count, itemSize=1.
   * Built alongside the InstancedMesh so the visibility predicate has
   * something to write into without reallocating geometry. The default
   * value (1.0) is set when `createInstancedMesh` runs so a freshly
   * built mesh shows every instance.
   */
  private instanceAlpha: THREE.InstancedBufferAttribute | null = null;
  /** Index → node-id mapping. Populated by SceneController via {@link setNodeIds}. */
  private nodeIds: string[] = [];
  /**
   * Last visibility set seen by {@link setVisibility}. `null` means
   * "never set" (everyone visible by default). `setHighlight` reads this
   * so visibility wins over highlight on the same instance.
   */
  private visibleIds: ReadonlySet<string> | null = null;
  /**
   * Last highlight set seen by {@link setHighlight}. Empty set means
   * "no highlight" (baseline alpha for everyone).
   */
  private highlightIds: ReadonlySet<string> = new Set();

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
        this.material = new THREE.MeshPhongMaterial({
          color: 0xffffff, // white base — instance colors render directly via setColorAt
          shininess: 30,
          specular: 0x111111,
          transparent: true,
          depthWrite: false,
        });
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
        // Higher segment count + slight specular highlight gives the spheres a
        // depth-aware look instead of a flat-shaded disc.
        this.geometry = new THREE.SphereGeometry(1, 24, 24);
        this.material = new THREE.MeshPhongMaterial({
          color: 0xffffff, // white base — instance colors render directly via setColorAt
          shininess: 40,
          specular: 0x222233,
          // `transparent:true` + `depthWrite:false` so the per-instance
          // alpha buffer (built below) can hide instances by driving their
          // fragment alpha to 0. Without `transparent` the GPU's alpha
          // test would still rasterise them; without `depthWrite:false`
          // the depth buffer would punch a hole the size of every
          // (invisible) sphere into the scene.
          transparent: true,
          depthWrite: false,
        });
        break;
    }
    this.instancedMesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.instancedMesh.count = count;

    // Per-instance alpha buffer. Default 1.0 (everyone visible). The
    // geometry holds it as `instanceAlpha`, mirroring Three.js's
    // built-in `instanceColor` naming. Read by the fragment-shader
    // patch installed below.
    const alphaArr = new Float32Array(count);
    for (let i = 0; i < count; i++) alphaArr[i] = 1;
    this.instanceAlpha = new THREE.InstancedBufferAttribute(alphaArr, 1);
    this.geometry.setAttribute('instanceAlpha', this.instanceAlpha);

    // Patch the material's shader so the final fragment alpha is
    // multiplied by the instance's alpha. We do this via
    // `onBeforeCompile` rather than a custom material so the existing
    // MeshPhongMaterial lighting path keeps working — we just pre-pend
    // an attribute declaration and a varying, then multiply in the
    // tail of the fragment shader.
    //
    // This patch is a no-op in environments where `onBeforeCompile`
    // isn't called (e.g. the headless test mock for `three`); the
    // visibility buffer still ends up correct on the geometry, so
    // tests can assert on the buffer contents directly without
    // exercising the shader.
    this.material.onBeforeCompile = (shader) => {
      // Vertex: attach the per-instance alpha attribute and forward it to
      // the fragment shader as a varying. `<begin_vertex>` is a stable
      // chunk name across recent Three.js versions.
      const vertexInjection = '#include <begin_vertex>';
      const patchedVertex = shader.vertexShader.replace(
        vertexInjection,
        `${vertexInjection}\nvInstanceAlpha = instanceAlpha;`,
      );
      if (patchedVertex === shader.vertexShader) {
        // eslint-disable-next-line no-console
        console.warn(
          '[NodeMesh] vertex shader chunk <begin_vertex> not found — instance visibility patch did not apply.',
        );
      }
      shader.vertexShader =
        `attribute float instanceAlpha;\nvarying float vInstanceAlpha;\n` +
        patchedVertex;

      // Fragment: multiply the final fragment alpha by the per-instance
      // varying. Three.js r150+ renamed `<output_fragment>` to
      // `<opaque_fragment>` (the chunk that emits the final
      // gl_FragColor); use the current name here.
      const fragmentInjection = '#include <opaque_fragment>';
      const patchedFragment = shader.fragmentShader.replace(
        fragmentInjection,
        `${fragmentInjection}\ngl_FragColor.a *= vInstanceAlpha;`,
      );
      if (patchedFragment === shader.fragmentShader) {
        // eslint-disable-next-line no-console
        console.warn(
          '[NodeMesh] fragment shader chunk <opaque_fragment> not found — instance visibility patch did not apply.',
        );
      }
      shader.fragmentShader =
        `varying float vInstanceAlpha;\n` + patchedFragment;
    };
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

  /**
   * Register the index → node-id mapping so {@link setVisibility} can
   * resolve instance indices from the predicate's id set. The
   * SceneController owns the canonical mapping; the mesh just keeps a
   * reference.
   */
  setNodeIds(ids: readonly string[]): void {
    this.nodeIds = ids.slice();
  }

  /**
   * Read-only access to the per-instance alpha buffer (for tests +
   * advanced consumers). `null` before {@link createInstancedMesh}.
   */
  getInstanceAlpha(): THREE.InstancedBufferAttribute | null {
    return this.instanceAlpha;
  }

  /**
   * Toggle per-instance visibility WITHOUT rebuild. For each instance
   * index, if the corresponding node id is in `visibleIds` we set alpha
   * to 1.0; otherwise 0.0. The shader patch installed in
   * {@link createInstancedMesh} multiplies the fragment alpha by this
   * value, so alpha=0 instances are completely transparent (and
   * `depthWrite:false` keeps them from punching a hole in the depth
   * buffer).
   *
   * No-op if the mesh hasn't been built yet, or if the node id mapping
   * hasn't been registered via {@link setNodeIds}.
   */
  setVisibility(visibleIds: ReadonlySet<string>): void {
    this.visibleIds = visibleIds;
    this.recomputeAlpha();
  }

  /**
   * Apply per-instance highlight emphasis WITHOUT rebuild. A non-empty
   * `highlightIds` drops alpha on non-matching instances to
   * {@link DIM_ALPHA}; an empty set restores baseline (everyone at full
   * alpha, modulated by the visibility set).
   *
   * No-op if the mesh hasn't been built yet, or if the node id mapping
   * hasn't been registered via {@link setNodeIds}.
   */
  setHighlight(highlightIds: ReadonlySet<string>): void {
    this.highlightIds = highlightIds;
    this.recomputeAlpha();
  }

  /**
   * Recompute the instance-alpha buffer from the current visibility +
   * highlight state. Visibility is dominant — a hidden node has alpha 0
   * regardless of highlight. Among visible nodes, an empty highlight
   * set means everyone is at full alpha (1.0); a non-empty set means
   * highlighted instances are at full alpha and others are dimmed.
   */
  private recomputeAlpha(): void {
    if (!this.instanceAlpha) return;
    if (this.nodeIds.length === 0) return;
    const arr = this.instanceAlpha.array as Float32Array;
    const n = Math.min(arr.length, this.nodeIds.length);
    const hasVisibility = this.visibleIds !== null;
    const visible = this.visibleIds;
    const hasHighlight = this.highlightIds.size > 0;
    for (let i = 0; i < n; i++) {
      const id = this.nodeIds[i];
      let alpha = 1;
      if (hasVisibility && !visible!.has(id)) {
        alpha = 0;
      } else if (hasHighlight && !this.highlightIds.has(id)) {
        alpha = DIM_ALPHA;
      }
      arr[i] = alpha;
    }
    this.instanceAlpha.needsUpdate = true;
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
    this.instanceAlpha = null;
    this.nodeIds = [];
    this.visibleIds = null;
    this.highlightIds = new Set();
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
