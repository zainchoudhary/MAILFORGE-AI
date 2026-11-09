import { api } from './api';

export const ACTIVE_STATUSES = ['queued', 'running'];
export const isRunActive = (run) => !!run && ACTIVE_STATUSES.includes(run.status);

export const EXAMPLE_PROMPTS = [
  'Find 20 technical recruiters in Berlin hiring backend engineers',
  'Find 15 talent acquisition managers at fintech startups in London',
  'Find 25 engineering recruiters hiring remote React developers in the US',
];

export const parseTargetCount = (value) => {
  if (value === '' || value == null) return undefined;
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(100, Math.max(1, number));
};

export const progressLine = (run) => {
  if (!run) return '';
  const progress = run.progress || {};
  const found = progress.candidates_kept ?? run.candidate_count ?? 0;
  const parts = [`${found} of ${run.target_count} leads found`];
  if (progress.queries_done) parts.push(`${progress.queries_done} searches`);
  if (progress.pages_fetched) parts.push(`${progress.pages_fetched} pages read`);
  const summary = parts.join(' · ');
  return progress.message ? `${progress.message} — ${summary}` : summary;
};

export const progressPercent = (run) => {
  if (!run?.target_count) return 0;
  const found = run.progress?.candidates_kept ?? run.candidate_count ?? 0;
  return Math.min(100, Math.round((found / run.target_count) * 100));
};

export const saveResultSummary = (result) => {
  const parts = [`${result.recipient_count} recipient${result.recipient_count === 1 ? '' : 's'} in “${result.group_name}”`];
  const detail = [];
  if (result.created) detail.push(`${result.created} new`);
  if (result.reused) detail.push(`${result.reused} already saved`);
  if (result.skipped) detail.push(`${result.skipped} suppressed skipped`);
  return detail.length ? `${parts[0]} (${detail.join(', ')})` : parts[0];
};

export const startRun = async ({ instruction, target_count }) =>
  (await api.post('/lead-finder/runs', { instruction, ...(target_count ? { target_count } : {}) })).data;
export const continueRun = async (id) => (await api.post(`/lead-finder/runs/${id}/continue`)).data;
export const cancelRun = async (id) => (await api.post(`/lead-finder/runs/${id}/cancel`)).data;
export const patchCandidate = async (runId, candidateId, changes) =>
  (await api.patch(`/lead-finder/runs/${runId}/candidates/${candidateId}`, changes)).data;

/** Toggle selection for many candidates in one request (Select all / Clear). */
export const setCandidatesSelected = async (runId, candidates, selected) => {
  const targets = (candidates || []).filter((candidate) => !!candidate.selected !== !!selected);
  if (!targets.length) return { updated: 0, selected };
  return (
    await api.post(`/lead-finder/runs/${runId}/candidates/selection`, {
      selected,
      candidate_ids: targets.map((candidate) => candidate.id),
    })
  ).data;
};

export const saveGroup = async (runId, group_name) =>
  (await api.post(`/lead-finder/runs/${runId}/save-group`, { group_name })).data;
export const deleteRun = async (id) => (await api.delete(`/lead-finder/runs/${id}`)).data;
export const deleteRuns = async (runIds) =>
  (await api.post('/lead-finder/runs/bulk-delete', { run_ids: runIds })).data;
