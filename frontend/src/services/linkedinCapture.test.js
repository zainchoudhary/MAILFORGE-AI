import { describe, expect, it } from 'vitest';
import { canCancelRun, detailCounts, isRunLive, progressLine, runTitle, saveResultSummary } from './linkedinCapture';

describe('linkedinCapture helpers', () => {
  it('detects live and cancellable runs', () => {
    expect(isRunLive({ status: 'idle' })).toBe(true);
    expect(isRunLive({ status: 'extracting' })).toBe(true);
    expect(isRunLive({ status: 'ready' })).toBe(false);
    expect(canCancelRun({ status: 'ready' })).toBe(true);
    expect(canCancelRun({ status: 'cancelled' })).toBe(false);
  });

  it('derives a run title', () => {
    expect(runTitle({ search_query_snapshot: 'python jobs' })).toBe('python jobs');
    expect(runTitle({ search_url: 'https://www.linkedin.com/jobs/search/?keywords=react' })).toBe('react');
    expect(runTitle({})).toBe('LinkedIn Jobs capture');
  });

  it('summarises progress and detail counts', () => {
    expect(progressLine({ job_count: 3, candidate_count: 1, progress: { message: 'Ready' } }))
      .toBe('Ready — 3 jobs captured · 1 lead extracted');
    expect(detailCounts([{ detail_status: 'fetched' }, { detail_status: 'failed' }, { detail_status: 'pending' }]))
      .toEqual({ pending: 1, fetched: 1, failed: 1, skipped: 0 });
  });

  it('summarises a save-group result', () => {
    expect(saveResultSummary({ group_name: 'A', recipient_count: 1, created: 1 })).toBe('1 recipient in “A” (1 new)');
  });
});
