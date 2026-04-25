import type { Plugin, PluginContext } from '../types.js';

export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private context: PluginContext | null = null;

  setContext(context: PluginContext): void {
    this.context = context;
  }

  install(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already installed`);
    }
    if (!this.context) {
      throw new Error('Plugin context not set. Call setContext() first.');
    }
    plugin.install(this.context);
    this.plugins.set(plugin.name, plugin);
  }

  uninstall(name: string): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.uninstall?.();
      this.plugins.delete(name);
    }
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  getAll(): Plugin[] {
    return [...this.plugins.values()];
  }
}
