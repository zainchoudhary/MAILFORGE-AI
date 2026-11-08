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
 * CAPTCHA / checkpoint heuristic.
 * Hard stop only on challenge URLs, or a real challenge form/iframe when the page has no
 * feed posts / job cards (avoids false positives on normal Home feed + Jobs search).
 * Never scans body copy — posts often say "checkpoint" / "unusual activity".
 */
export function isBlockedPage(url = "", doc = null) {
  const path = pathOf(url);
  if (BLOCK_URL.test(path)) return true;
  if (!doc || !doc.querySelector) return false;
  const hasWork =
    Boolean(doc.querySelector(DETAIL_SELECTORS.description)) ||
    Boolean(
      doc.querySelector(
        ".feed-shared-update-v2, .occludable-update, .job-card-container, .jobs-search-results__list-item, [data-chameleon-result-urn], .reusable-search__result-container, .entity-result"
      )
    ) ||
    Boolean(doc.querySelector('a[href*="/jobs/view/"]'));
  if (hasWork) return false; // still looking at real LinkedIn content — keep hunting
  if (doc.querySelector(BLOCK_SELECTORS)) return true;
  for (const h of doc.querySelectorAll(BLOCK_HEADING_SELECTOR)) {
    if (BLOCK_HEADING.test(h.textContent || "")) return true;
  }
  return false;
}

const MAX_STALL = 4; // deepCapture only: consecutive iterations with nothing new => list exhausted

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

/**
 * Keep scrolling until `targetEmails` are found (or Stop / block / hard post cap).
 * Never stops early on a round-count "cap" — LinkedIn loads slowly and emails are sparse.
 * onBatch(batch) should return { emailsFound: number }.
 */
export async function huntLeads({
  targetEmails = 20,
  maxItems = 5000,
  delayMs = 800,
  onBatch,
  parse,
  shouldStop = async () => false,
  isBlocked = async () => false,
  scrollOrNextPage,
  sleep: wait = sleep,
}) {
  const target = Math.max(1, Math.min(500, Number(targetEmails) || 20));
  // Safety valve only: prefer email target. ~100 posts scanned per email needed.
  const cap = Math.max(target * 100, Math.min(5000, Number(maxItems) || 5000));
  // Consecutive rounds with zero NEW posts before we admit the feed is done.
  const maxEmptyStalls = Math.max(80, target * 5);
  const seen = new Set();
  let emails = 0;
  let emptyStalls = 0;
  let scrollFails = 0;

  while (emails < target && seen.size < cap) {
    if (await shouldStop()) return { count: seen.size, emails, reason: "stopped" };
    if (await isBlocked()) return { count: seen.size, emails, reason: "blocked" };

    const batch = parse().filter((j) => !seen.has(j.linkedin_job_id));
    batch.forEach((j) => seen.add(j.linkedin_job_id));
    if (batch.length) {
      const result = await onBatch(batch);
      emails = Math.max(emails, Number(result?.emailsFound) || 0);
      emptyStalls = 0;
      scrollFails = 0;
    } else {
      emptyStalls += 1;
    }

    if (emails >= target) return { count: seen.size, emails, reason: "target" };

    // Stuck: many empty parses in a row → feed really ended (or selectors broke).
    if (emptyStalls >= maxEmptyStalls) {
      return { count: seen.size, emails, reason: "exhausted" };
    }

    const moved = await scrollOrNextPage();
    if (!moved) {
      scrollFails += 1;
      // Bounce/retry wait — LinkedIn often needs a pause at the bottom before more cards.
      await wait(Math.max(delayMs, 1400));
      // Only exhaust when scroll + parse both stalled for a long stretch.
      if (scrollFails >= maxEmptyStalls) {
        return { count: seen.size, emails, reason: "exhausted" };
      }
      continue;
    }

    scrollFails = 0;
    await wait(delayMs);
  }

  return {
    count: seen.size,
    emails,
    reason: emails >= target ? "target" : seen.size >= cap ? "cap" : "exhausted",
  };
}
