import type { NodeId } from '../types.js';

/**
 * HTML-overlay rendering of the "+" hover affordance — the small button
 * that appears next to a hovered node and, when clicked, requests
 * expansion of that node's neighbors.
 *
 * The affordance is a single `<button class="ig-expand-affordance">`
 * mounted inside a sibling overlay div (`.ig-affordance-overlay`,
 * z-index 6 — above the label overlay at 5, below the tooltip at 100).
 *
 * Pointer-event discipline:
 *   - The overlay div has `pointer-events: none` so hover raycasts on
 *     the WebGL canvas behind it are unaffected.
 *   - The button itself has `pointer-events: auto` (set in CSS) so the
 *     user can click it.
 *   - The button never moves in / out of the same node that triggered
 *     it: SceneController keeps `show()` active while the cursor is on
 *     the node OR on the button. When the cursor leaves the button
 *     onto a different node (or off-canvas), SceneController's hover
 *     raycast naturally calls `hide()` (or `show()` for the new node).
 *
 * The button's screen position is updated each frame by
 * SceneController's `tick()` via {@link updatePosition}. The class
 * itself stores the latest (x, y) and writes a `transform: translate(...)
 * translate(var(--ig-expand-offset-x), var(--ig-expand-offset-y))` so
 * consumers can fine-tune offset placement via CSS.
 *
 * Visual styling — colour, size, radius, shadow, offset — is owned by
 * the consumer via 11 CSS custom properties on `.ig-expand-affordance`.
 * See `src/themes/default.css` for the defaults.
 */
export class ExpandAffordance {
  private container: HTMLElement | null = null;
  private overlay: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private onExpand: ((nodeId: NodeId) => void) | null = null;
  private currentNodeId: NodeId | null = null;
  private lastX: number = 0;
  private lastY: number = 0;

  // Bound click handler so we can remove it on detach.
  private readonly onClickBound = (event: Event): void => {
    // Don't let the click propagate to the canvas behind us — the
    // canvas listens for `click` to dispatch `onNodeClick`, which is
    // a separate semantic event.
    event.stopPropagation();
    const id = this.currentNodeId;
    if (id !== null && this.onExpand) {
      this.onExpand(id);
    }
  };

  /**
   * Mount the overlay + button as children of `container`. Idempotent;
   * a second call before {@link detach} is a no-op.
   */
  attach(container: HTMLElement): void {
    if (this.container) return;
    this.container = container;

    const overlay = document.createElement('div');
    overlay.className = 'ig-affordance-overlay';
    // Match the styling discipline of `.ig-label-overlay` so that even
    // if the consumer hasn't loaded our CSS the layer behaves sanely:
    // it covers the canvas, doesn't capture pointer events, and clips
    // children that drift off-screen.
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.overflow = 'hidden';
    container.appendChild(overlay);
    this.overlay = overlay;

    const button = document.createElement('button');
    button.className = 'ig-expand-affordance';
    button.type = 'button';
    button.setAttribute('aria-label', 'Expand neighbors');
    button.textContent = '+';
    // Inline default of `display: none` so the button is hidden on
    // mount even if the consumer hasn't loaded our CSS yet. `show()`
    // flips it to `flex` (or whatever the CSS overrides to).
    button.style.display = 'none';
    button.addEventListener('click', this.onClickBound);
    overlay.appendChild(button);
    this.button = button;
  }

  /**
   * Reveal the affordance for `nodeId`. Re-uses the same button DOM
   * element across nodes — only the `data-node-id` attribute and the
   * cached `currentNodeId` change. Position is NOT updated here; the
   * caller (SceneController) calls {@link updatePosition} once per
   * frame in `tick()`.
   */
  show(nodeId: NodeId): void {
    if (!this.button) return;
    this.currentNodeId = nodeId;
    this.button.dataset.nodeId = nodeId;
    // `flex` to honour the centring `align-items` / `justify-content`
    // declared in CSS. Falls through to the consumer's value if they
    // override `display`.
    this.button.style.display = 'flex';
  }

  /**
   * Hide the affordance + clear the cached node id. Safe to call when
   * already hidden.
   */
  hide(): void {
    if (!this.button) return;
    this.currentNodeId = null;
    delete this.button.dataset.nodeId;
    this.button.style.display = 'none';
  }

  /**
   * Push a fresh screen-space (x, y) into the button's transform.
   * Combines a base `translate(x, y)` with a CSS-variable-driven
   * offset so consumers can override placement via theming. SceneController
   * calls this each frame from `tick()` for the hovered node.
   */
  updatePosition(x: number, y: number): void {
    if (!this.button) return;
    this.lastX = x;
    this.lastY = y;
    this.button.style.transform = `translate(${x}px, ${y}px) translate(var(--ig-expand-offset-x, 12px), var(--ig-expand-offset-y, -12px))`;
  }

  /**
   * Register the click handler. The handler receives the node id of
   * the affordance that was clicked. SceneController exposes
   * `setOnExpandRequest(handler)` which forwards to this.
   */
  setOnExpand(handler: (nodeId: NodeId) => void): void {
    this.onExpand = handler;
  }

  /**
   * The currently-shown node id, or `null` when hidden. Useful for
   * tests + introspection.
   */
  getCurrentNodeId(): NodeId | null {
    return this.currentNodeId;
  }

  /** Latest position written via {@link updatePosition}. */
  getLastPosition(): { x: number; y: number } {
    return { x: this.lastX, y: this.lastY };
  }

  /** The mounted button (exposed for tests + advanced consumers). */
  getButton(): HTMLButtonElement | null {
    return this.button;
  }

  /** The mounted overlay element (exposed for tests + advanced consumers). */
  getOverlay(): HTMLDivElement | null {
    return this.overlay;
  }

  /**
   * Tear everything down: removes the click listener, removes the
   * overlay (and button) from the DOM, and clears all state. Safe to
   * call repeatedly.
   */
  detach(): void {
    if (this.button) {
      this.button.removeEventListener('click', this.onClickBound);
      this.button = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.container = null;
    this.currentNodeId = null;
    this.onExpand = null;
    this.lastX = 0;
    this.lastY = 0;
  }
}
