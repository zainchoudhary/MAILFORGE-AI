// Upload retry (network/5xx only) + Studio-requested pending-details poll.
import assert from "node:assert/strict";

const store = {};
const calls = [];
let activeTab = { id: 7, url: "https://www.linkedin.com/jobs/search/?keywords=x" };
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onMessage: { addListener() {} },
    sendMessage: async () => {},
  },
  sidePanel: { setPanelBehavior: async () => {} },
  alarms: { create() {}, onAlarm: { addListener() {} } },
  tabs: {
    query: async () => [activeTab],
    sendMessage: async (_id, msg) => {
      calls.push(msg);
      if (msg.type === "FETCH_DETAIL") return { ok: true, detail_payload: { description: "d" } };
      return { ok: true };
    },
  },
  storage: {
    local: {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: store[keys] };
        if (Array.isArray(keys)) {
          const out = {};
          for (const k of keys) if (k in store) out[k] = store[k];
          return out;
        }
        return { ...store };
      },
      async set(patch) {
        Object.assign(store, patch);
      },
      async remove(keys) {
        for (const k of [].concat(keys)) delete store[k];
      },
    },
  },
};

const api = await import("../src/lib/api.js");
const { handlers } = await import("../src/background.js");
api.retryConfig.baseMs = 1;

const jsonOk = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const httpErr = (status, text = `HTTP ${status}`) => ({ ok: false, status, json: async () => ({}), text: async () => text });

function seed(capture = { runId: "run-1", status: "done", jobIds: ["1", "2"], detailDone: ["1", "2"] }) {
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, { apiBase: "http://localhost:8000", access_token: "tok", refresh_token: "r", capture });
  calls.length = 0;
}

// --- retries on 5xx then succeeds ---
{
  seed();
  let n = 0;
  globalThis.fetch = async () => (++n < 3 ? httpErr(503) : jsonOk({ inserted: 1 }));
  const r = await api.batchJobs("run-1", [{ linkedin_job_id: "1" }]);
  assert.equal(r.inserted, 1);
  assert.equal(n, 3, "two 503s then success");
}

// --- retries network errors ---
{
  seed();
  let n = 0;
  globalThis.fetch = async () => {
    if (++n < 2) throw new TypeError("Failed to fetch");
    return jsonOk({ inserted: 1 });
  };
  await api.batchJobs("run-1", [{ linkedin_job_id: "1" }]);
  assert.equal(n, 2);
}

// --- gives up after retries and surfaces the error (never silent) ---
{
  seed();
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    return httpErr(500, "boom");
  };
  await assert.rejects(() => api.batchJobs("run-1", [{ linkedin_job_id: "1" }]), /boom/);
  assert.equal(n, 1 + api.retryConfig.retries);
}

// --- 4xx is never retried ---
{
  seed();
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    return httpErr(422, "bad payload");
  };
  await assert.rejects(() => api.batchJobs("run-1", [{ linkedin_job_id: "1" }]), /bad payload/);
  assert.equal(n, 1, "422 must not be retried");
}

// --- START_RUN-style upload failure marks capture as error ---
{
  seed({ runId: "run-1", status: "done" });
  globalThis.fetch = async () => httpErr(502, "bad gateway");
  await assert.rejects(() => handlers.DEEP_BATCH({ jobs: [{ linkedin_job_id: "9", title: "t" }] }), /Upload failed after retries/);
  assert.equal(store.capture.status, "error");
}

// --- pending poll: only when Studio flagged the run ---
function route(run, pending) {
  globalThis.fetch = async (url) => {
    if (/\/jobs\?detail_status=pending/.test(url)) return jsonOk({ items: pending, total: pending.length });
    if (/\/jobs\/batch$/.test(url)) return jsonOk({ inserted: 0 });
    if (/\/runs\/run-1$/.test(url)) return jsonOk(run);
    return httpErr(404);
  };
}

{
  seed();
  route({ id: "run-1", status: "idle", progress: {} }, [{ linkedin_job_id: "1" }]);
  const r = await handlers.POLL_PENDING();
  assert.equal(r.started, false);
  assert.equal(r.reason, "not_requested");
  assert.equal(calls.length, 0);
}

{
  seed(); // both jobs already scraped locally; Studio re-requested them
  route({ id: "run-1", status: "idle", progress: { details_requested: true } }, [
    { linkedin_job_id: "1" },
    { linkedin_job_id: "2" },
  ]);
  const r = await handlers.POLL_PENDING();
  assert.equal(r.started, true);
  assert.equal(r.pending, 2, "Studio re-request bypasses local detailDone");
  await new Promise((resolve) => setTimeout(resolve, 1700)); // let the detail loop finish (delay clamp 400ms+)
  assert.ok(calls.some((c) => c.type === "FETCH_DETAIL" && c.jobId === "1"));
}

{
  seed({ runId: "run-1", status: "done", stopReason: "stopped" });
  route({ id: "run-1", status: "idle", progress: { details_requested: true } }, [{ linkedin_job_id: "1" }]);
  const r = await handlers.POLL_PENDING();
  assert.equal(r.started, false, "user Stop suppresses auto-poll");
}

{
  seed();
  activeTab = { id: 7, url: "https://example.com/" };
  route({ id: "run-1", status: "idle", progress: { details_requested: true } }, [{ linkedin_job_id: "1" }]);
  const r = await handlers.POLL_PENDING();
  assert.equal(r.started, false, "no LinkedIn tab: no scrape");
}

console.log("retry + pending-poll tests passed");
process.exit(0);
