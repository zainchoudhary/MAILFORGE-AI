// Pure deep-capture loop and block detection; DOM/Chrome access is injected.
import { BLOCK_URL, BLOCK_TEXT } from "./selectors.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CAPTCHA / checkpoint heuristic on page text or a challenge-style URL. */
export function isBlockedPage(text = "", url = "") {
  return BLOCK_URL.test(url || "") || BLOCK_TEXT.test(text || "");
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
