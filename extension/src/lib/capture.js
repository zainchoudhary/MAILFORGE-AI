// Pure deep-capture loop and block detection; DOM/Chrome access is injected.
import { BLOCK_URL, BLOCK_SELECTORS, BLOCK_HEADING, BLOCK_HEADING_SELECTOR, DETAIL_SELECTORS } from "./selectors.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url || "").split(/[?#]/)[0];
  }
}

/**
 * CAPTCHA / checkpoint heuristic: challenge-style URL path, or challenge UI in the document.
 * Deliberately does NOT scan body text, so job descriptions mentioning "checkpoint" are safe.
 */
export function isBlockedPage(url = "", doc = null) {
  if (BLOCK_URL.test(pathOf(url))) return true;
  if (!doc || !doc.querySelector) return false;
  if (doc.querySelector(BLOCK_SELECTORS)) return true;
  if (doc.querySelector(DETAIL_SELECTORS.description)) return false;
  for (const h of doc.querySelectorAll(BLOCK_HEADING_SELECTOR)) {
    if (BLOCK_HEADING.test(h.textContent || "")) return true;
  }
  return false;
}

const MAX_STALL = 4; // consecutive iterations with nothing new => list exhausted

/**
 * Scroll/paginate until `maxJobs`, STOP, a block page, or no more results.
 * Returns { count, reason } with reason in: cap | stopped | blocked | exhausted.
 */
export async function deepCapture({
  maxJobs = 300,
  delayMs = 800,
  onBatch,
  parse,
  shouldStop = async () => false,
  isBlocked = async () => false,
  scrollOrNextPage,
  sleep: wait = sleep,
}) {
  const seen = new Set();
  let stall = 0;
  while (seen.size < maxJobs) {
    if (await shouldStop()) return { count: seen.size, reason: "stopped" };
    if (await isBlocked()) return { count: seen.size, reason: "blocked" };
    const room = maxJobs - seen.size;
    const batch = parse().filter((j) => !seen.has(j.linkedin_job_id)).slice(0, room);
    batch.forEach((j) => seen.add(j.linkedin_job_id));
    if (batch.length) {
      await onBatch(batch);
      stall = 0;
    } else if (++stall >= MAX_STALL) {
      return { count: seen.size, reason: "exhausted" };
    }
    if (seen.size >= maxJobs) break;
    const moved = await scrollOrNextPage();
    if (!moved) return { count: seen.size, reason: "exhausted" };
    await wait(delayMs);
  }
  return { count: seen.size, reason: "cap" };
}
