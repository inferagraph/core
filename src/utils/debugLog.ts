/**
 * Runtime-toggleable debug logger.
 *
 * Off by default. To enable in a browser DevTools console:
 *
 *   IG_DEBUG = true
 *
 * Set back to false (or undefined) to silence. The flag is read on
 * every call; logs appear from the moment it flips. Argument lists
 * are still evaluated when disabled, so callers should avoid heavy
 * computation in the call args (object literals + primitive math
 * are fine; chained .map().filter() over large arrays are not).
 *
 * The flag lives on globalThis so it works in both the browser
 * (window.IG_DEBUG) and Node-side test environments.
 */
declare global {
  // eslint-disable-next-line no-var
  var IG_DEBUG: boolean | undefined;
}

export function debugLog(...args: unknown[]): void {
  if (typeof globalThis !== 'undefined' && globalThis.IG_DEBUG === true) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}
