import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../src/data/MemoryManager.js';
import type { NodeId } from '../../src/types.js';

/**
 * Lightweight fake of the {@link GraphStore} surface MemoryManager touches.
 * Exposes the trio of methods needed (`removeNode`, `hasNode`, `nodeCount`)
 * plus a tiny helper to seed nodes for testing.
 */
class FakeStore {
  private readonly nodes = new Set<NodeId>();
  removeNodeSpy = vi.fn<(id: NodeId) => void>();

  add(id: NodeId): void {
    this.nodes.add(id);
  }
  removeNode(id: NodeId): void {
    this.removeNodeSpy(id);
    this.nodes.delete(id);
  }
  hasNode(id: NodeId): boolean {
    return this.nodes.has(id);
  }
  get nodeCount(): number {
    return this.nodes.size;
  }
  getAllNodes(): Array<{ id: NodeId }> {
    return [...this.nodes].map((id) => ({ id }));
  }
}

describe('MemoryManager', () => {
  let store: FakeStore;
  let dropEmbedding: ReturnType<typeof vi.fn>;
  let dropInferredEdgesFor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new FakeStore();
    dropEmbedding = vi.fn();
    dropInferredEdgesFor = vi.fn();
  });

  describe('touch + timestamps', () => {
    it('records a timestamp on first touch', () => {
      const m = new MemoryManager(store);
      m.touch('a');
      expect(m.timestamps.has('a')).toBe(true);
    });

    it('updates the timestamp when touched again (most-recent wins)', () => {
      const m = new MemoryManager(store);
      m.touch('a');
      m.touch('b');
      m.touch('a'); // re-touch — should now be newer than b
      const ta = m.timestamps.get('a');
      const tb = m.timestamps.get('b');
      expect(ta).toBeDefined();
      expect(tb).toBeDefined();
      expect(ta!).toBeGreaterThan(tb!);
    });

    it('forget drops the entry from the LRU map', () => {
      const m = new MemoryManager(store);
      m.touch('a');
      m.forget('a');
      expect(m.timestamps.has('a')).toBe(false);
    });
  });

  describe('cap', () => {
    it('exposes the configured cap', () => {
      const m = new MemoryManager(store, undefined, 100);
      expect(m.cap).toBe(100);
    });

    it('treats 0 as "no cap" so accidental config does not nuke the graph', () => {
      const m = new MemoryManager(store, undefined, 0);
      expect(m.cap).toBeUndefined();
    });

    it('returns no-op when no cap is configured', () => {
      const m = new MemoryManager(store);
      store.add('a');
      store.add('b');
      const evicted = m.enforceCap();
      expect(evicted).toEqual([]);
      expect(store.nodeCount).toBe(2);
    });
  });

  describe('enforceCap', () => {
    it('returns [] when the store is already under cap', () => {
      const m = new MemoryManager(store, undefined, 5);
      store.add('a');
      store.add('b');
      m.touch('a');
      m.touch('b');
      const evicted = m.enforceCap();
      expect(evicted).toEqual([]);
    });

    it('evicts the oldest non-protected node when over cap', () => {
      const m = new MemoryManager(store, undefined, 2);
      store.add('a');
      store.add('b');
      store.add('c');
      m.touch('a');
      m.touch('b');
      m.touch('c'); // c is newest, a is oldest
      const evicted = m.enforceCap();
      expect(evicted).toEqual(['a']);
      expect(store.hasNode('a')).toBe(false);
      expect(store.hasNode('b')).toBe(true);
      expect(store.hasNode('c')).toBe(true);
    });

    it('respects protected ids — never evicts a protected node', () => {
      const m = new MemoryManager(store, undefined, 2);
      store.add('a');
      store.add('b');
      store.add('c');
      store.add('d');
      m.touch('a');
      m.touch('b');
      m.touch('c');
      m.touch('d');
      // Protect c (newer than a/b). Cap is 2, store has 4. The two oldest
      // non-protected (a, b) should be evicted; d is newer than them and
      // survives since after dropping a + b we're under cap.
      const evicted = m.enforceCap(new Set(['c']));
      expect(evicted).toEqual(['a', 'b']);
      expect(store.hasNode('c')).toBe(true);
      expect(store.hasNode('d')).toBe(true);
    });

    it('terminates when every remaining node is protected', () => {
      const m = new MemoryManager(store, undefined, 1);
      store.add('a');
      store.add('b');
      m.touch('a');
      m.touch('b');
      // Both protected — eviction can't proceed past this point.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const evicted = m.enforceCap(new Set(['a', 'b']));
      expect(evicted).toEqual([]);
      expect(store.nodeCount).toBe(2);
      warnSpy.mockRestore();
    });

    it('skips eviction with a console warning when protectedIds.size > cap', () => {
      const m = new MemoryManager(store, undefined, 2);
      store.add('a');
      store.add('b');
      store.add('c');
      store.add('d');
      m.touch('a');
      m.touch('b');
      m.touch('c');
      m.touch('d');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Protected set has 3 entries but cap is 2 — evicting won't help.
      const evicted = m.enforceCap(new Set(['a', 'b', 'c']));
      expect(evicted).toEqual([]);
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/Skipping eviction/);
      warnSpy.mockRestore();
    });

    it('coordinates AIEngine cleanup on every eviction', () => {
      const m = new MemoryManager(
        store,
        { dropEmbedding, dropInferredEdgesFor },
        1,
      );
      store.add('a');
      store.add('b');
      m.touch('a');
      m.touch('b'); // a is older
      const evicted = m.enforceCap();
      expect(evicted).toEqual(['a']);
      expect(dropEmbedding).toHaveBeenCalledWith('a');
      expect(dropInferredEdgesFor).toHaveBeenCalledWith('a');
    });

    it('survives async dropEmbedding rejections', async () => {
      dropEmbedding.mockReturnValue(Promise.reject(new Error('boom')));
      const m = new MemoryManager(
        store,
        { dropEmbedding, dropInferredEdgesFor },
        1,
      );
      store.add('a');
      store.add('b');
      m.touch('a');
      m.touch('b');
      // Should not throw despite the rejected promise.
      expect(() => m.enforceCap()).not.toThrow();
    });

    it('drops the LRU entry after eviction so the same node is not re-evicted later', () => {
      const m = new MemoryManager(store, undefined, 1);
      store.add('a');
      store.add('b');
      m.touch('a');
      m.touch('b');
      m.enforceCap();
      expect(m.timestamps.has('a')).toBe(false);
      // Subsequent enforce shouldn't try to re-evict a.
      const evicted2 = m.enforceCap();
      expect(evicted2).toEqual([]);
    });

    it('removeNode is called on the store for every victim', () => {
      const m = new MemoryManager(store, undefined, 1);
      store.add('a');
      store.add('b');
      store.add('c');
      m.touch('a');
      m.touch('b');
      m.touch('c');
      m.enforceCap();
      // a + b should both be removed (c is newest).
      expect(store.removeNodeSpy).toHaveBeenCalledWith('a');
      expect(store.removeNodeSpy).toHaveBeenCalledWith('b');
      expect(store.removeNodeSpy).not.toHaveBeenCalledWith('c');
    });

    it('skips nodes not in the store (LRU drift) without throwing', () => {
      const m = new MemoryManager(store, undefined, 1);
      store.add('a');
      m.touch('a');
      m.touch('phantom'); // touched but never added to store
      const evicted = m.enforceCap();
      // Even though phantom is older, only nodes actually in the store
      // can be evicted. Store has a (size 1) and cap is 1 — already under.
      expect(evicted).toEqual([]);
    });

    it('aiEngine without dropEmbedding still evicts cleanly', () => {
      const m = new MemoryManager(store, {}, 1);
      store.add('a');
      store.add('b');
      m.touch('a');
      m.touch('b');
      const evicted = m.enforceCap();
      expect(evicted).toEqual(['a']);
    });

    it('returns evicted ids in oldest-first order', () => {
      const m = new MemoryManager(store, undefined, 1);
      store.add('a');
      store.add('b');
      store.add('c');
      store.add('d');
      m.touch('a');
      m.touch('b');
      m.touch('c');
      m.touch('d');
      const evicted = m.enforceCap();
      expect(evicted).toEqual(['a', 'b', 'c']);
    });
  });
});
