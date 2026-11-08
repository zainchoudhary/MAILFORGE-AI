// DOM-agnostic job-detail reader (live document in the content script, linkedom in Node tests).
import { DETAIL_SELECTORS } from "./selectors.js";

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
    const addr = decodeURIComponent((a.getAttribute("href") || "").replace(/^mailto:/i, "").split("?")[0]).trim();
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
