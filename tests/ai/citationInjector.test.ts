/**
 * 0.12.0 — citation wire format becomes `[[token|matched-text]]`. Both
 * segments REQUIRED. The injector rewrites every match (not just the
 * first), preserves the model's exact casing in the matched-text segment,
 * strips any model-emitted `[[...]]` tokens up-front (they are garbage
 * — the prompt no longer asks for them), and operates on a candidate
 * list `{ token, title }[]` independent of the per-turn rerank. The host
 * passes candidates derived from the WHOLE store so out-of-relevantNodes
 * entities still cite when their title appears.
 *
 * Per memory `feedback_tdd_discipline.md` — failing test FIRST.
 * Per memory `feedback_no_backcompat_in_inferagraph` — old `[[slug]]`
 * (no pipe) is gone. No tests pin the old shape.
 */

import { describe, it, expect } from 'vitest';
import {
  injectCitations,
  type CitationCandidate,
} from '../../src/ai/citationInjector.js';

function cand(token: string, title: string): CitationCandidate {
  return { token, title };
}

describe('injectCitations (0.12.0 wire — `[[token|matched-text]]`)', () => {
  it('inserts a citation for every entity in left-to-right order', () => {
    const text = 'Cain slew Abel.';
    const out = injectCitations(text, [cand('cain', 'Cain'), cand('abel', 'Abel')]);
    expect(out).toBe('[[cain|Cain]] slew [[abel|Abel]].');
  });

  it('replaces EVERY occurrence of an entity (not just the first)', () => {
    const text = 'Cain murdered. Cain fled. Cain was banished.';
    const out = injectCitations(text, [cand('cain', 'Cain')]);
    expect(out).toBe(
      '[[cain|Cain]] murdered. [[cain|Cain]] fled. [[cain|Cain]] was banished.',
    );
  });

  it('preserves the model\'s exact casing per match (case-insensitive matching)', () => {
    const text = 'adam was Adam ADAM';
    const out = injectCitations(text, [cand('adam', 'Adam')]);
    expect(out).toBe('[[adam|adam]] was [[adam|Adam]] [[adam|ADAM]]');
  });

  it('handles multi-word titles and preserves the matched casing verbatim', () => {
    const text = 'Cain was banished to the land of Nod.';
    const out = injectCitations(text, [
      cand('cain', 'Cain'),
      cand('land-of-nod', 'land of Nod'),
    ]);
    expect(out).toBe('[[cain|Cain]] was banished to the [[land-of-nod|land of Nod]].');
  });

  it('keeps markdown emphasis intact — citation replaces only the title text', () => {
    const text = '**Cain** slew his brother.';
    const out = injectCitations(text, [cand('cain', 'Cain')]);
    expect(out).toBe('**[[cain|Cain]]** slew his brother.');
  });

  it('respects word boundaries — does not match inside a longer word', () => {
    const text = 'Caintown was named for him.';
    const out = injectCitations(text, [cand('cain', 'Cain')]);
    expect(out).toBe('Caintown was named for him.');
  });

  it('prefers longer titles when nodes share a prefix (longest-first)', () => {
    const text = 'Adam Smith met Adam.';
    const out = injectCitations(text, [
      cand('adam', 'Adam'),
      cand('adam-smith', 'Adam Smith'),
    ]);
    expect(out).toBe('[[adam-smith|Adam Smith]] met [[adam|Adam]].');
  });

  it('strips any pre-existing `[[...]]` tokens emitted by the model and re-runs the scan cleanly', () => {
    const text = 'Cain [[cain]] slew Abel.';
    const out = injectCitations(text, [cand('cain', 'Cain'), cand('abel', 'Abel')]);
    // The strip pass collapses runs of whitespace introduced by the
    // removal so the prose stays clean.
    expect(out).toBe('[[cain|Cain]] slew [[abel|Abel]].');
  });

  it('strips `[[token|matched]]` shape tokens too — the function is idempotent', () => {
    const cited = '[[cain|Cain]] slew [[abel|Abel]].';
    const out = injectCitations(cited, [
      cand('cain', 'Cain'),
      cand('abel', 'Abel'),
    ]);
    expect(out).toBe('[[cain|Cain]] slew [[abel|Abel]].');
  });

  it('places the citation in place even when punctuation immediately follows', () => {
    const text = 'Cain, who slew Abel, fled.';
    const out = injectCitations(text, [cand('cain', 'Cain'), cand('abel', 'Abel')]);
    expect(out).toBe('[[cain|Cain]], who slew [[abel|Abel]], fled.');
  });

  it('cites an entity even when it is OUTSIDE the per-turn relevant set, as long as the candidate is present', () => {
    // The host now passes candidates derived from the whole store so
    // entities the rerank top-K dropped (e.g. Seth in a turn focused on
    // Adam) still get cited when their title appears in the response.
    const text = 'Father of Cain, Abel, and Seth.';
    const out = injectCitations(text, [
      cand('cain', 'Cain'),
      cand('abel', 'Abel'),
      cand('seth', 'Seth'),
    ]);
    expect(out).toBe(
      'Father of [[cain|Cain]], [[abel|Abel]], and [[seth|Seth]].',
    );
  });

  it('returns the input unchanged for empty text or empty candidates list', () => {
    expect(injectCitations('', [])).toBe('');
    expect(injectCitations('hello', [])).toBe('hello');
    expect(injectCitations('', [cand('cain', 'Cain')])).toBe('');
  });

  it('returns the input unchanged when no candidate title appears in the text', () => {
    expect(injectCitations('He fled.', [cand('cain', 'Cain')])).toBe('He fled.');
  });

  it('skips candidates that are missing token or title (safety guard)', () => {
    const text = 'Cain slew Abel.';
    // `as` casts simulate an upstream caller forgetting to filter — the
    // injector tolerates these gracefully rather than throwing.
    const out = injectCitations(text, [
      cand('cain', 'Cain'),
      { token: '', title: 'Abel' } as CitationCandidate,
      { token: 'eve', title: '' } as CitationCandidate,
    ]);
    expect(out).toBe('[[cain|Cain]] slew Abel.');
  });
});
