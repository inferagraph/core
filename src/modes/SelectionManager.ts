import type { NodeId } from '../types.js';

export interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export type SelectionMode = 'replace' | 'add' | 'toggle';

export class SelectionManager {
  private selected = new Set<NodeId>();
  private onChangeCallbacks: Array<(selected: Set<NodeId>) => void> = [];

  /** Select a single node. Mode controls behavior:
   * 'replace' (default) - clear selection, select this node
   * 'add' (Shift+click) - add to existing selection
   * 'toggle' (Ctrl/Cmd+click) - toggle this node in selection
   */
  select(nodeId: NodeId, mode: SelectionMode = 'replace'): void {
    switch (mode) {
      case 'replace':
        this.selected.clear();
        this.selected.add(nodeId);
        break;
      case 'add':
        this.selected.add(nodeId);
        break;
      case 'toggle':
        if (this.selected.has(nodeId)) {
          this.selected.delete(nodeId);
        } else {
          this.selected.add(nodeId);
        }
        break;
    }
    this.notifyChange();
  }

  /** Select multiple nodes at once */
  selectMany(nodeIds: NodeId[], mode: SelectionMode = 'replace'): void {
    if (mode === 'replace') {
      this.selected.clear();
    }
    for (const id of nodeIds) {
      if (mode === 'toggle') {
        if (this.selected.has(id)) {
          this.selected.delete(id);
        } else {
          this.selected.add(id);
        }
      } else {
        this.selected.add(id);
      }
    }
    this.notifyChange();
  }

  /** Deselect a specific node */
  deselect(nodeId: NodeId): void {
    this.selected.delete(nodeId);
    this.notifyChange();
  }

  /** Clear all selection */
  clearSelection(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.notifyChange();
  }

  /** Check if a node is selected */
  isSelected(nodeId: NodeId): boolean {
    return this.selected.has(nodeId);
  }

  /** Get all selected node IDs */
  getSelected(): Set<NodeId> {
    return new Set(this.selected);
  }

  /** Get selected count */
  get count(): number {
    return this.selected.size;
  }

  /** Register change listener */
  onChange(callback: (selected: Set<NodeId>) => void): void {
    this.onChangeCallbacks.push(callback);
  }

  /** Remove change listener */
  offChange(callback: (selected: Set<NodeId>) => void): void {
    const idx = this.onChangeCallbacks.indexOf(callback);
    if (idx !== -1) this.onChangeCallbacks.splice(idx, 1);
  }

  /** Select nodes within a rectangular screen region.
   * Requires a map of nodeId to screen position.
   */
  selectByRect(
    rect: SelectionRect,
    nodePositions: Map<NodeId, { x: number; y: number }>,
    mode: SelectionMode = 'replace'
  ): void {
    const minX = Math.min(rect.startX, rect.endX);
    const maxX = Math.max(rect.startX, rect.endX);
    const minY = Math.min(rect.startY, rect.endY);
    const maxY = Math.max(rect.startY, rect.endY);

    const nodesInRect: NodeId[] = [];
    for (const [id, pos] of nodePositions) {
      if (pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY) {
        nodesInRect.push(id);
      }
    }
    this.selectMany(nodesInRect, mode);
  }

  private notifyChange(): void {
    const snapshot = this.getSelected();
    for (const cb of this.onChangeCallbacks) {
      cb(snapshot);
    }
  }
}
