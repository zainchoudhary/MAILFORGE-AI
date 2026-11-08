// Deep-capture loop + detail extraction tests (plain Node, linkedom for DOM).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseHTML } from "linkedom";
import { deepCapture, isBlockedPage } from "../src/lib/capture.js";
import { extractDetail, buildDetailJob, paneMatchesJob, acceptDetail } from "../src/lib/detail.js";
import { clampMaxJobs, clampDeepDelay, clampDetailDelay } from "../src/lib/limits.js";

const here = dirname(fileURLToPath(import.meta.url));
const noSleep = async () => {};
const job = (n) => ({ linkedin_job_id: String(n), title: `J${n}` });

// Simulated infinite list: each scroll reveals 5 more jobs.
function fakeList(pages = Infinity) {
  let visible = 5;
  let scrolls = 0;
  return {
    parse: () => Array.from({ length: visible }, (_, i) => job(i + 1)),
    scrollOrNextPage: async () => {
      if (scrolls >= pages) return false;
      scrolls += 1;
      visible += 5;
      return true;
    },
  };
}

// 1. cap: stops at maxJobs, never uploads more than the cap, no duplicates.
{
  const batches = [];
  const l = fakeList();
  const r = await deepCapture({ maxJobs: 12, delayMs: 0, sleep: noSleep, ...l, onBatch: async (b) => batches.push(b) });
  const ids = batches.flat().map((j) => j.linkedin_job_id);
  assert.equal(r.reason, "cap");
  assert.equal(r.count, 12);
  assert.equal(new Set(ids).size, 12);
  assert.equal(ids.length, 12);
}

// 2. exhausted: no more pages.
{
  const batches = [];
  const r = await deepCapture({ maxJobs: 300, delayMs: 0, sleep: noSleep, ...fakeList(2), onBatch: async (b) => batches.push(b) });
  assert.equal(r.reason, "exhausted");
  assert.equal(r.count, 15);
}

// 3. STOP flag halts the loop after the current batch.
{
  let stop = false;
  const batches = [];
  const r = await deepCapture({
    maxJobs: 300, delayMs: 0, sleep: noSleep, ...fakeList(),
    shouldStop: async () => stop,
    onBatch: async (b) => { batches.push(b); stop = true; },
  });
  assert.equal(r.reason, "stopped");
  assert.equal(batches.length, 1);
}

// 4. CAPTCHA/checkpoint heuristic halts the loop.
{
  let calls = 0;
  const r = await deepCapture({
    maxJobs: 300, delayMs: 0, sleep: noSleep, ...fakeList(),
    isBlocked: async () => ++calls > 1,
    onBatch: async () => {},
  });
  assert.equal(r.reason, "blocked");
  assert.equal(r.count, 5);
}
{
  const doc = (html) => parseHTML(`<html><body>${html}</body></html>`).document;
  const jobsUrl = "https://www.linkedin.com/jobs/search/?keywords=checkpoint";
  // URL path heuristics.
  assert.equal(isBlockedPage("https://www.linkedin.com/checkpoint/challenge/abc"), true);
  assert.equal(isBlockedPage("https://www.linkedin.com/authwall?trk=x"), true);
  assert.equal(isBlockedPage("https://www.linkedin.com/uas/login-submit"), true);
  assert.equal(isBlockedPage(jobsUrl, doc("<p>ok</p>")), false, "query text is not a block");
  // Challenge UI containers / headings on non-job pages.
  assert.equal(isBlockedPage(jobsUrl, doc('<div id="captcha-internal"></div>')), true);
  assert.equal(isBlockedPage(jobsUrl, doc('<iframe src="https://x/captcha/y"></iframe>')), true);
  assert.equal(isBlockedPage(jobsUrl, doc("<h1>Let's do a quick security check</h1>")), true);
  // False positives: job text mentioning these words must NOT block.
  const jobWithWords = '<div class="jobs-description__content"><h2>Security checkpoint engineer</h2><p>Detect unusual activity, security verification, checkpoint reviews. Verify you are a human-centered thinker.</p></div>';
  assert.equal(isBlockedPage("https://www.linkedin.com/jobs/view/123/", doc(jobWithWords)), false);
  assert.equal(isBlockedPage(jobsUrl, doc("<p>Checkpoint and unusual activity detection role</p>")), false);
  assert.equal(isBlockedPage("https://www.linkedin.com/jobs/search/", doc("<p>Senior Engineer jobs in Berlin</p>")), false);
}

// 5. stalled list (nothing new) terminates even if scrolling "moves".
{
  const r = await deepCapture({
    maxJobs: 300, delayMs: 0, sleep: noSleep,
    parse: () => [job(1)], scrollOrNextPage: async () => true, onBatch: async () => {},
  });
  assert.equal(r.reason, "exhausted");
  assert.equal(r.count, 1);
}

// 6. onBatch failure propagates (content script reports DEEP_DONE error).
await assert.rejects(
  deepCapture({ maxJobs: 10, delayMs: 0, sleep: noSleep, ...fakeList(), onBatch: async () => { throw new Error("boom"); } }),
  /boom/,
);

// 7. Detail fixture: emails (inline text and mailto-only) survive into detail_payload.
{
  const html = readFileSync(join(here, "../fixtures/job-detail.html"), "utf8");
  const { document } = parseHTML(html);
  const d = extractDetail(document);
  assert.ok(d, "description found");
  const built = buildDetailJob("3900000001", d);
  assert.equal(built.linkedin_job_id, "3900000001");
  const p = built.detail_payload;
  assert.ok(p.description.includes("careers@acme-robotics.com"), "inline email survives");
  assert.ok(p.description.includes("recruiter.jane@acme-robotics.com"), "mailto email survives");
  assert.ok(p.raw_text.includes("careers@acme-robotics.com"));
  assert.ok(p.raw_text.includes("Acme Robotics"), "raw_text covers the whole pane");
  assert.ok(p.description.includes("warehouse robots"), "whitespace normalized");
  assert.equal(p.source, "detail_pane");
  assert.equal(extractDetail(parseHTML("<html><body><p>nothing</p></body></html>").document), null);
  assert.deepEqual(buildDetailJob("42", null), { linkedin_job_id: "42", detail_status: "failed" });
}

// 8. Malformed mailto percent-escape must not throw.
{
  const { document } = parseHTML('<html><body><div class="jobs-description__content">Apply <a href="mailto:bad%ZZ@x.com">here</a></div></body></html>');
  const d = extractDetail(document);
  assert.ok(d && d.description.includes("bad%ZZ@x.com"));
}

// 9. Stale-pane protection: never attach previous job's text to a new job id.
{
  const pane = (id, text) => parseHTML(`<html><body><div class="scaffold-layout__detail"><a href="/jobs/view/${id}/">t</a><div class="jobs-description__content">${text}</div></div></body></html>`).document;
  const docA = pane("111", "Job A text");
  assert.equal(paneMatchesJob(docA, "111"), true);
  assert.equal(paneMatchesJob(docA, "222"), false);
  assert.equal(paneMatchesJob(parseHTML(readFileSync(join(here, "../fixtures/job-detail.html"), "utf8")).document, "222"), null, "no id in pane => unknown");
  const A = { description: "Job A text" };
  // URL already says job 222 but pane still shows A (same text): reject when we switched.
  assert.equal(acceptDetail({ d: A, before: A, switched: true, urlMatches: true, paneMatch: null }), false);
  // Pane id proves it is a different job: reject even if text changed.
  assert.equal(acceptDetail({ d: { description: "C" }, before: A, switched: true, urlMatches: true, paneMatch: false }), false);
  // Changed text + URL match: accept.
  assert.equal(acceptDetail({ d: { description: "B" }, before: A, switched: true, urlMatches: true, paneMatch: null }), true);
  // Changed text but no URL/pane evidence: reject.
  assert.equal(acceptDetail({ d: { description: "B" }, before: A, switched: true, urlMatches: false, paneMatch: null }), false);
  // Changed text + pane id match (URL not updated): accept.
  assert.equal(acceptDetail({ d: { description: "B" }, before: A, switched: true, urlMatches: false, paneMatch: true }), true);
  // Already on the job: accept unless pane provably other job.
  assert.equal(acceptDetail({ d: A, before: A, switched: false, urlMatches: true, paneMatch: null }), true);
  assert.equal(acceptDetail({ d: A, before: A, switched: false, urlMatches: true, paneMatch: false }), false);
  assert.equal(acceptDetail({ d: null, before: A, switched: true, urlMatches: true, paneMatch: true }), false);
}

// 10. Input clamps.
assert.equal(clampMaxJobs(100000), 500);
assert.equal(clampMaxJobs(0), 1);
assert.equal(clampMaxJobs(-5), 1);
assert.equal(clampMaxJobs("abc"), 300);
assert.equal(clampMaxJobs(undefined), 300);
assert.equal(clampMaxJobs(42.9), 42);
assert.equal(clampDeepDelay(0), 400);
assert.equal(clampDeepDelay(50), 400);
assert.equal(clampDeepDelay("x"), 800);
assert.equal(clampDeepDelay(2000), 2000);
assert.equal(clampDetailDelay(1), 400);
assert.equal(clampDetailDelay(undefined), 1200);

console.log("deep capture tests passed (cap, exhausted, stop, blocked, stall, error, detail email, stale pane, clamps)");
