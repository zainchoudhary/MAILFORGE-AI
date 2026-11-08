import { api } from './api';

const BASE = '/linkedin-capture';

export const CAPTURE_RUNS_KEY = `${BASE}/runs`;

/** Runs that can still change on their own (extension adding jobs, extraction in flight). */
export const LIVE_STATUSES = ['idle', 'extracting'];
export const isRunLive = (run) => !!run && LIVE_STATUSES.includes(run.status);
/** True while any job still awaits details from the extension. */
export const hasPendingDetails = (jobs) => (jobs || []).some((job) => (job.detail_status || 'pending') === 'pending');
export const isRunExtracting = (run) => run?.status === 'extracting';
export const canCancelRun = (run) => !!run && ['idle', 'extracting', 'ready'].includes(run.status);

export const INSTALL_STEPS = [
  'Install the MailForge LinkedIn Jobs extension in Chrome (chrome://extensions → Load unpacked → select the “extension” folder).',
  'Set API base to the backend and sign in from the extension side panel with your MailForge account.',
  'Open a LinkedIn Jobs search and use Capture visible, Deep capture, or Fetch details. Jobs stream into this page.',
  'Emails are extracted only if they appear on the job post. Review leads here, then save them as a recipient group.',
];

export const runTitle = (run) => {
  if (!run) return '';
  const label = (run.search_query_snapshot || '').trim();
  if (label) return label;
  const url = (run.search_url || '').trim();
  if (url) {
    try {
      const parsed = new URL(url);
      const keywords = parsed.searchParams.get('keywords');
      if (keywords) return keywords;
      return `${parsed.hostname}${parsed.pathname}`;
    } catch {
      return url;
    }
  }
  return 'LinkedIn Jobs capture';
};

export const progressLine = (run) => {
  if (!run) return '';
  const progress = run.progress || {};
  const jobs = run.job_count ?? progress.listed ?? 0;
  const leads = run.candidate_count ?? 0;
  const summary = `${jobs} job${jobs === 1 ? '' : 's'} captured · ${leads} lead${leads === 1 ? '' : 's'} extracted`;
  return progress.message ? `${progress.message} — ${summary}` : summary;
};

export const detailCounts = (jobs) => {
  const counts = { pending: 0, fetched: 0, failed: 0, skipped: 0 };
  for (const job of jobs || []) {
    const key = job.detail_status in counts ? job.detail_status : 'pending';
    counts[key] += 1;
  }
  return counts;
};

export const saveResultSummary = (result) => {
  const parts = [`${result.recipient_count} recipient${result.recipient_count === 1 ? '' : 's'} in “${result.group_name}”`];
  const detail = [];
  if (result.created) detail.push(`${result.created} new`);
  if (result.reused) detail.push(`${result.reused} already saved`);
  if (result.skipped) detail.push(`${result.skipped} suppressed skipped`);
  return detail.length ? `${parts[0]} (${detail.join(', ')})` : parts[0];
};

export const listRuns = async () => (await api.get(`${BASE}/runs`)).data;
export const getRun = async (id) => (await api.get(`${BASE}/runs/${id}`)).data;
export const listJobs = async (runId, { page = 1, limit = 100 } = {}) =>
  (await api.get(`${BASE}/runs/${runId}/jobs`, { params: { page, limit } })).data;
export const listCandidates = async (runId, { page = 1, limit = 100 } = {}) =>
  (await api.get(`${BASE}/runs/${runId}/candidates`, { params: { page, limit } })).data;
export const patchCandidate = async (runId, candidateId, changes) =>
  (await api.patch(`${BASE}/runs/${runId}/candidates/${candidateId}`, changes)).data;

/**
 * Toggle selection for many candidates (Select all / Clear); API has no bulk endpoint.
 * Uses allSettled so a partial failure never leaves requests in flight; callers should
 * refetch from the server when `failed > 0`.
 */
export const setCandidatesSelected = async (runId, candidates, selected) => {
  const targets = (candidates || []).filter((candidate) => !!candidate.selected !== !!selected);
  if (!targets.length) return { updated: 0, failed: 0, selected, errors: [] };
  const results = await Promise.allSettled(targets.map((candidate) => patchCandidate(runId, candidate.id, { selected })));
  const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
  return { updated: results.length - errors.length, failed: errors.length, selected, errors };
};

export const fetchJobDetails = async (runId, jobIds) =>
  (await api.post(`${BASE}/runs/${runId}/jobs/fetch-details`, { job_ids: jobIds ?? null })).data;
export const extractRun = async (runId, jobRawIds) =>
  (await api.post(`${BASE}/runs/${runId}/extract`, { job_raw_ids: jobRawIds ?? null })).data;
export const cancelRun = async (id) => (await api.post(`${BASE}/runs/${id}/cancel`)).data;
export const saveGroup = async (runId, group_name, candidate_ids) =>
  (await api.post(`${BASE}/runs/${runId}/save-group`, { group_name, ...(candidate_ids ? { candidate_ids } : {}) })).data;
