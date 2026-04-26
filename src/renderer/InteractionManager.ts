type EventCallback = (event: { nodeId?: string; x: number; y: number }) => void;

export class InteractionManager {
  private listeners = new Map<string, Set<EventCallback>>();
  private _container: HTMLElement | null = null;

  get container(): HTMLElement | null {
    return this._container;
  }

  attach(container: HTMLElement): void {
    this._container = container;
  }

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  emit(event: string, data: { nodeId?: string; x: number; y: number }): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(data);
      }
    }
  }

  detach(): void {
    this.listeners.clear();
    this._container = null;
  }
}
