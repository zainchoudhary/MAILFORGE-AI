// DOM-agnostic list parser: works on any root exposing querySelectorAll
// (live document in the content script, linkedom in Node tests).
import { SELECTORS, JOB_ID_FROM_URL, JOB_ID_FROM_QUERY } from "./selectors.js";

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

export function extractJobId({ attrValues = [], href = "" } = {}) {
  for (const v of attrValues) {
    const m = /(\d{5,})/.exec(v || "");
    if (m) return m[1];
  }
  const m = JOB_ID_FROM_URL.exec(href) || JOB_ID_FROM_QUERY.exec(href);
  return m ? m[1] : "";
}

export function canonicalJobUrl(jobId, href, base = "https://www.linkedin.com") {
  if (jobId) return `${base}/jobs/view/${jobId}/`;
  try {
    const u = new URL(href, base);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}

function firstText(card, selector) {
  const el = card.querySelector(selector);
  return el ? clean(el.textContent) : "";
}

export function parseJobCard(card, base = "https://www.linkedin.com") {
  const linkEl = card.querySelector(SELECTORS.link);
  const href = linkEl ? linkEl.getAttribute("href") || "" : "";
  const attrValues = [];
  for (const name of SELECTORS.jobIdAttrs) {
    const own = card.getAttribute && card.getAttribute(name);
    if (own) attrValues.push(own);
    const child = card.querySelector(`[${name}]`);
    if (child) attrValues.push(child.getAttribute(name));
  }
  const linkedin_job_id = extractJobId({ attrValues, href });
  if (!linkedin_job_id) return null;
  const title = firstText(card, SELECTORS.title);
  const company = firstText(card, SELECTORS.company);
  const location = firstText(card, SELECTORS.location);
  const job_url = canonicalJobUrl(linkedin_job_id, href, base);
  return {
    linkedin_job_id,
    title,
    company,
    location,
    job_url,
    list_payload: { title, company, location, href, source: "list_card" },
  };
}

function parseFromJobLinks(root, base, seen) {
  const jobs = [];
  for (const linkEl of root.querySelectorAll(SELECTORS.jobViewLinks)) {
    const href = linkEl.getAttribute("href") || "";
    const linkedin_job_id = extractJobId({ href });
    if (!linkedin_job_id || seen.has(linkedin_job_id)) continue;
    // Prefer a nearby card-like ancestor for title/company; otherwise use the link text.
    const card =
      linkEl.closest(
        "li, .job-card-container, .jobs-search-results__list-item, .scaffold-layout__list-item"
      ) || linkEl.parentElement;
    const title =
      (card && firstText(card, SELECTORS.title)) || clean(linkEl.textContent) || "";
    const company = (card && firstText(card, SELECTORS.company)) || "";
    const location = (card && firstText(card, SELECTORS.location)) || "";
    if (!title && !company) continue;
    seen.add(linkedin_job_id);
    jobs.push({
      linkedin_job_id,
      title,
      company,
      location,
      job_url: canonicalJobUrl(linkedin_job_id, href, base),
      list_payload: { title, company, location, href, source: "jobs_view_link" },
    });
  }
  return jobs;
}

export function parseVisibleJobs(root, base) {
  const seen = new Set();
  const jobs = [];
  for (const card of root.querySelectorAll(SELECTORS.jobCard)) {
    const job = parseJobCard(card, base);
    if (!job || seen.has(job.linkedin_job_id)) continue;
    seen.add(job.linkedin_job_id);
    jobs.push(job);
  }
  // LinkedIn often renames list-item classes; fall back to any /jobs/view/ anchors.
  if (jobs.length === 0) {
    jobs.push(...parseFromJobLinks(root, base, seen));
  }
  return jobs;
}
