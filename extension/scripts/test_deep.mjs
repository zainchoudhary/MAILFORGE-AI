// Deep-capture loop + detail extraction tests (plain Node, linkedom for DOM).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseHTML } from "linkedom";
import { deepCapture, isBlockedPage } from "../src/lib/capture.js";
import { extractDetail, buildDetailJob } from "../src/lib/detail.js";

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
assert.equal(isBlockedPage("Let's do a quick security check", ""), true);
assert.equal(isBlockedPage("Security checkpoint", ""), true);
assert.equal(isBlockedPage("", "https://www.linkedin.com/checkpoint/challenge/abc"), true);
assert.equal(isBlockedPage("Senior Engineer jobs in Berlin", "https://www.linkedin.com/jobs/search/"), false);

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

console.log("deep capture tests passed (cap, exhausted, stop, blocked, stall, error, detail email)");
