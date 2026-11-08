// DOM-agnostic job-detail reader (live document in the content script, linkedom in Node tests).
import { DETAIL_SELECTORS, JOB_ID_FROM_URL, JOB_ID_FROM_QUERY } from "./selectors.js";

// Prefer innerText (keeps line breaks in a real browser); fall back to textContent (linkedom).
function textOf(el) {
  if (!el) return "";
  const raw = typeof el.innerText === "string" && el.innerText ? el.innerText : el.textContent || "";
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mailtoEmails(root) {
  const out = [];
  for (const a of root.querySelectorAll(DETAIL_SELECTORS.mailto)) {
    const rawAddr = (a.getAttribute("href") || "").replace(/^mailto:/i, "").split("?")[0];
    let addr;
    try {
      addr = decodeURIComponent(rawAddr).trim();
    } catch {
      addr = rawAddr.trim(); // malformed %-escape: keep the raw text rather than throw
    }
    if (addr) out.push(addr);
  }
  return out;
}

/** Read the open job's description. Returns null when no description container is present. */
export function extractDetail(root) {
  const descEl = root.querySelector(DETAIL_SELECTORS.description);
  if (!descEl) return null;
  let description = textOf(descEl);
  if (!description) return null;
  // Emails exposed only as mailto link targets would otherwise be lost.
  const lower = description.toLowerCase();
  const extra = mailtoEmails(descEl).filter((e) => !lower.includes(e.toLowerCase()));
  if (extra.length) description += `\n${extra.join("\n")}`;
  const paneEl = root.querySelector(DETAIL_SELECTORS.pane);
  const raw_text = paneEl ? textOf(paneEl) : description;
  return { description, raw_text };
}

/** Build the jobs/batch item. `detail` null => mark the fetch failed (never overwrites fetched). */
export function buildDetailJob(jobId, detail) {
  if (!detail) return { linkedin_job_id: String(jobId), detail_status: "failed" };
  return {
    linkedin_job_id: String(jobId),
    detail_payload: {
      description: detail.description,
      raw_text: detail.raw_text,
      source: "detail_pane",
    },
  };
}

/**
 * Job ids referenced by links in the detail pane's header area (outside the description body,
 * whose links may point at unrelated jobs). Empty array => pane exposes no id (unknown).
 */
export function paneJobIds(root) {
  const pane = root.querySelector(DETAIL_SELECTORS.pane);
  if (!pane) return [];
  const desc = root.querySelector(DETAIL_SELECTORS.description);
  const ids = new Set();
  for (const a of pane.querySelectorAll("a[href*='/jobs/view/'], a[href*='currentJobId=']")) {
    if (desc && desc.contains(a)) continue;
    const href = a.getAttribute("href") || "";
    const m = JOB_ID_FROM_URL.exec(href) || JOB_ID_FROM_QUERY.exec(href);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

/** true = pane belongs to jobId, false = pane shows a different job, null = cannot tell. */
export function paneMatchesJob(root, jobId) {
  const ids = paneJobIds(root);
  if (!ids.length) return null;
  return ids.length === 1 && ids[0] === String(jobId);
}

/**
 * Decide whether the extracted description may be attached to the target job.
 * Never accepts a pane that provably belongs to another job, nor (when we had to switch
 * jobs) one whose text is unchanged from the previously open job.
 */
export function acceptDetail({ d, before, switched, urlMatches, paneMatch }) {
  if (!d) return false;
  if (paneMatch === false) return false;
  if (!switched) return urlMatches || paneMatch === true;
  if (before && d.description === before.description) return false;
  return urlMatches || paneMatch === true;
}
