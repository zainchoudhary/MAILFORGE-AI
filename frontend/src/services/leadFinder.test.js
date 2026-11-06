import { describe, expect, it } from 'vitest';
import { isRunActive, parseTargetCount, progressLine, progressPercent, saveResultSummary } from './leadFinder';

describe('leadFinder helpers', () => {
  it('detects active runs', () => {
    expect(isRunActive({ status: 'queued' })).toBe(true);
    expect(isRunActive({ status: 'running' })).toBe(true);
    expect(isRunActive({ status: 'ready' })).toBe(false);
    expect(isRunActive(null)).toBe(false);
  });

  it('parses and clamps the target count', () => {
    expect(parseTargetCount('')).toBeUndefined();
    expect(parseTargetCount('abc')).toBeUndefined();
    expect(parseTargetCount('250')).toBe(100);
    expect(parseTargetCount('0')).toBe(1);
    expect(parseTargetCount('20')).toBe(20);
  });

  it('summarises progress', () => {
    const run = { target_count: 20, candidate_count: 3, progress: { candidates_kept: 5, queries_done: 2, message: 'Searching' } };
    expect(progressLine(run)).toBe('Searching — 5 of 20 leads found · 2 searches');
    expect(progressPercent(run)).toBe(25);
    expect(progressPercent({ target_count: 10, candidate_count: 50, progress: {} })).toBe(100);
  });

  it('summarises a save-group result', () => {
    expect(saveResultSummary({ group_name: 'Berlin', recipient_count: 3, created: 2, reused: 1, skipped: 1 }))
      .toBe('3 recipients in “Berlin” (2 new, 1 already saved, 1 suppressed skipped)');
  });
});
