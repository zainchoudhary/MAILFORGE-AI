// Server-side clamps for capture options (UI min/max attributes are not trusted).
export const LIMITS = {
  maxJobs: { min: 1, max: 5000, def: 300 },
  deepDelayMs: { min: 400, def: 800 },
  detailDelayMs: { min: 400, def: 1200 },
};
export const MAX_CONSECUTIVE_DETAIL_FAILURES = 5;

const clamp = (v, min, max, def) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};

export function clampMaxJobs(v) {
  const { min, max, def } = LIMITS.maxJobs;
  return clamp(v, min, max, def);
}
export function clampDeepDelay(v) {
  return clamp(v, LIMITS.deepDelayMs.min, Infinity, LIMITS.deepDelayMs.def);
}
export function clampDetailDelay(v) {
  return clamp(v, LIMITS.detailDelayMs.min, Infinity, LIMITS.detailDelayMs.def);
}
