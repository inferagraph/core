import type { NodeId } from '../types.js';

export interface KeyBinding {
  key: string;        // e.g. 'ArrowRight', 'Tab', 'Enter', 'Escape', 'Delete'
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  action: string;     // action name, e.g. 'navigate-next', 'select', 'deselect-all'
}

export type KeyAction = (context: KeyboardContext) => void;

export interface KeyboardContext {
  focusedNodeId: NodeId | null;
  getNeighborIds: (nodeId: NodeId) => NodeId[];
  getAllNodeIds: () => NodeId[];
  onFocusChange: (nodeId: NodeId | null) => void;
  onSelect: (nodeId: NodeId) => void;
  onDeselect: () => void;
}

export class KeyboardManager {
  private container: HTMLElement | null = null;
  private bindings: KeyBinding[] = [];
  private actions = new Map<string, KeyAction>();
  private focusedNodeId: NodeId | null = null;
  private context: KeyboardContext | null = null;
  private enabled = true;

  constructor() {
    // Register default bindings
    this.registerDefaults();
  }

  /** Attach to a container element and start listening for keyboard events */
  attach(container: HTMLElement): void {
    this.container = container;
    container.setAttribute('tabindex', '0');
    container.setAttribute('role', 'application');
    container.setAttribute('aria-label', 'Graph visualization');
    container.addEventListener('keydown', this.handleKeyDown);
  }

  /** Detach from container */
  detach(): void {
    if (this.container) {
      this.container.removeEventListener('keydown', this.handleKeyDown);
    }
    this.container = null;
  }

  /** Check if attached */
  isAttached(): boolean {
    return this.container !== null;
  }

  /** Set the context for keyboard actions */
  setContext(context: KeyboardContext): void {
    this.context = context;
  }

  /** Enable/disable keyboard handling */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Register a custom key binding */
  addBinding(binding: KeyBinding): void {
    this.bindings.push(binding);
  }

  /** Remove bindings for an action */
  removeBindingsForAction(action: string): void {
    this.bindings = this.bindings.filter(b => b.action !== action);
  }

  /** Register a custom action handler */
  registerAction(name: string, handler: KeyAction): void {
    this.actions.set(name, handler);
  }

  /** Get all registered bindings */
  getBindings(): KeyBinding[] {
    return [...this.bindings];
  }

  /** Get focused node */
  getFocusedNodeId(): NodeId | null {
    return this.focusedNodeId;
  }

  /** Set focused node programmatically */
  setFocusedNodeId(nodeId: NodeId | null): void {
    this.focusedNodeId = nodeId;
    this.context?.onFocusChange(nodeId);
  }

  private registerDefaults(): void {
    // Navigation
    this.addBinding({ key: 'Tab', action: 'focus-next' });
    this.addBinding({ key: 'Tab', shift: true, action: 'focus-prev' });
    this.addBinding({ key: 'ArrowRight', action: 'navigate-right' });
    this.addBinding({ key: 'ArrowLeft', action: 'navigate-left' });
    this.addBinding({ key: 'ArrowUp', action: 'navigate-up' });
    this.addBinding({ key: 'ArrowDown', action: 'navigate-down' });

    // Selection
    this.addBinding({ key: 'Enter', action: 'select' });
    this.addBinding({ key: ' ', action: 'select' });
    this.addBinding({ key: 'Escape', action: 'deselect-all' });

    // Register default action handlers
    this.registerAction('focus-next', (ctx) => {
      const allNodes = ctx.getAllNodeIds();
      if (allNodes.length === 0) return;

      if (!ctx.focusedNodeId) {
        ctx.onFocusChange(allNodes[0]);
        return;
      }

      const currentIdx = allNodes.indexOf(ctx.focusedNodeId);
      const nextIdx = (currentIdx + 1) % allNodes.length;
      ctx.onFocusChange(allNodes[nextIdx]);
    });

    this.registerAction('focus-prev', (ctx) => {
      const allNodes = ctx.getAllNodeIds();
      if (allNodes.length === 0) return;

      if (!ctx.focusedNodeId) {
        ctx.onFocusChange(allNodes[allNodes.length - 1]);
        return;
      }

      const currentIdx = allNodes.indexOf(ctx.focusedNodeId);
      const prevIdx = (currentIdx - 1 + allNodes.length) % allNodes.length;
      ctx.onFocusChange(allNodes[prevIdx]);
    });

    this.registerAction('navigate-right', (ctx) => {
      if (!ctx.focusedNodeId) return;
      const neighbors = ctx.getNeighborIds(ctx.focusedNodeId);
      if (neighbors.length > 0) {
        ctx.onFocusChange(neighbors[0]);
      }
    });

    this.registerAction('navigate-left', (ctx) => {
      if (!ctx.focusedNodeId) return;
      const neighbors = ctx.getNeighborIds(ctx.focusedNodeId);
      if (neighbors.length > 1) {
        ctx.onFocusChange(neighbors[neighbors.length - 1]);
      } else if (neighbors.length > 0) {
        ctx.onFocusChange(neighbors[0]);
      }
    });

    this.registerAction('navigate-up', (ctx) => {
      if (!ctx.focusedNodeId) return;
      const neighbors = ctx.getNeighborIds(ctx.focusedNodeId);
      if (neighbors.length > 0) {
        // Navigate to first neighbor (graph doesn't have strict up/down)
        ctx.onFocusChange(neighbors[0]);
      }
    });

    this.registerAction('navigate-down', (ctx) => {
      if (!ctx.focusedNodeId) return;
      const neighbors = ctx.getNeighborIds(ctx.focusedNodeId);
      if (neighbors.length > 1) {
        ctx.onFocusChange(neighbors[1]);
      } else if (neighbors.length > 0) {
        ctx.onFocusChange(neighbors[0]);
      }
    });

    this.registerAction('select', (ctx) => {
      if (ctx.focusedNodeId) {
        ctx.onSelect(ctx.focusedNodeId);
      }
    });

    this.registerAction('deselect-all', (ctx) => {
      ctx.onDeselect();
      ctx.onFocusChange(null);
    });
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || !this.context) return;

    const binding = this.findBinding(event);
    if (!binding) return;

    const handler = this.actions.get(binding.action);
    if (!handler) return;

    event.preventDefault();

    // Update context with current focus
    const ctx: KeyboardContext = {
      ...this.context,
      focusedNodeId: this.focusedNodeId,
    };

    // Wrap onFocusChange to update internal state
    const originalOnFocusChange = ctx.onFocusChange;
    ctx.onFocusChange = (nodeId) => {
      this.focusedNodeId = nodeId;
      originalOnFocusChange(nodeId);
    };

    handler(ctx);
  };

  private findBinding(event: KeyboardEvent): KeyBinding | undefined {
    return this.bindings.find(b => {
      if (b.key !== event.key) return false;
      if (b.ctrl && !event.ctrlKey) return false;
      if (b.shift && !event.shiftKey) return false;
      if (b.alt && !event.altKey) return false;
      if (b.meta && !event.metaKey) return false;
      // Also check negative: if binding doesn't require modifier but event has it
      if (!b.ctrl && event.ctrlKey) return false;
      if (!b.shift && event.shiftKey) return false;
      if (!b.alt && event.altKey) return false;
      if (!b.meta && event.metaKey) return false;
      return true;
    });
  }
}
