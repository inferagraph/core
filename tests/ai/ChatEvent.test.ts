import { describe, it, expect } from 'vitest';
import type { ChatEvent } from '../../src/ai/ChatEvent.js';

describe('ChatEvent', () => {
  it('narrows correctly on text events', () => {
    const ev: ChatEvent = { type: 'text', delta: 'hello' };
    if (ev.type === 'text') {
      expect(ev.delta).toBe('hello');
    } else {
      throw new Error('expected text');
    }
  });

  it('narrows correctly on apply_filter events', () => {
    const ev: ChatEvent = {
      type: 'apply_filter',
      spec: { type: ['person'] },
      predicate: () => true,
    };
    if (ev.type === 'apply_filter') {
      expect(ev.spec).toEqual({ type: ['person'] });
      expect(typeof ev.predicate).toBe('function');
    } else {
      throw new Error('expected apply_filter');
    }
  });

  it('narrows correctly on highlight events', () => {
    const ids = new Set(['a', 'b']);
    const ev: ChatEvent = { type: 'highlight', ids };
    if (ev.type === 'highlight') {
      expect(ev.ids).toBe(ids);
      expect(ev.ids.has('a')).toBe(true);
    } else {
      throw new Error('expected highlight');
    }
  });

  it('narrows correctly on focus events', () => {
    const ev: ChatEvent = { type: 'focus', nodeId: 'x' };
    if (ev.type === 'focus') {
      expect(ev.nodeId).toBe('x');
    } else {
      throw new Error('expected focus');
    }
  });

  it('narrows correctly on annotate events', () => {
    const ev: ChatEvent = { type: 'annotate', nodeId: 'x', text: 'hi' };
    if (ev.type === 'annotate') {
      expect(ev.nodeId).toBe('x');
      expect(ev.text).toBe('hi');
    } else {
      throw new Error('expected annotate');
    }
  });

  it('narrows correctly on done events', () => {
    const ev: ChatEvent = { type: 'done', reason: 'stop' };
    if (ev.type === 'done') {
      expect(ev.reason).toBe('stop');
      expect(ev.error).toBeUndefined();
    } else {
      throw new Error('expected done');
    }
  });

  it('done events can carry an error message', () => {
    const ev: ChatEvent = { type: 'done', reason: 'stop', error: 'boom' };
    if (ev.type === 'done') {
      expect(ev.error).toBe('boom');
    } else {
      throw new Error('expected done');
    }
  });
});
