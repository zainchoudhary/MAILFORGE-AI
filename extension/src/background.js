import {
  login,
  logout,
  getSettings,
  saveSettings,
  normalizeBase,
  createRun,
  batchJobs,
} from "./lib/api.js";
import { buildDetailJob } from "./lib/detail.js";
import { sleep } from "./lib/capture.js";
import { clampMaxJobs, clampDeepDelay, clampDetailDelay, MAX_CONSECUTIVE_DETAIL_FAILURES } from "./lib/limits.js";

const BATCH_SIZE = 100;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// Serialize all capture work so concurrent clicks cannot interleave batches.
let queue = Promise.resolve();
const enqueue = (fn) => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
};

// Same storage wipe RESET_RUN uses — also called on LOGIN / LOGOUT / apiBase change.
async function resetRun() {
  await chrome.storage.local.remove("capture");
}

async function setCapture(patch) {
  const { capture = {} } = await chrome.storage.local.get("capture");
  const next = { ...capture, ...patch };
  await chrome.storage.local.set({ capture: next });
  chrome.runtime.sendMessage({ type: "CAPTURE_PROGRESS", capture: next }).catch(() => {});
  return next;
}

async function activeLinkedInTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/www\.linkedin\.com\/jobs\//.test(tab.url || "")) {
    throw new Error("Open a LinkedIn Jobs search page in the active tab first");
  }
  return tab;
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Tab was open before the extension loaded: inject the content script once.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/jobs.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function captureVisible() {
  const tab = await activeLinkedInTab();
  const res = await sendToTab(tab.id, { type: "CAPTURE_VISIBLE" });
  if (!res || !res.ok) throw new Error((res && res.error) || "Capture failed");
  return res; // { jobs, search_url }
}

async function ensureRun({ newRun = false, search_url = "" } = {}) {
  let { capture = {} } = await chrome.storage.local.get("capture");
  if (newRun || !capture.runId) {
    await setCapture({ status: "creating_run", total: 0, sent: 0, jobIds: [], detailDone: [], error: "" });
    const run = await createRun({ search_url, search_query_snapshot: search_url });
    capture = await setCapture({ runId: run.id, total: 0, sent: 0 });
  }
  return capture;
}

// Upload list jobs in chunks, tracking totals and captured ids (for later detail fetch).
async function uploadJobs(runId, jobs) {
  let { capture = {} } = await chrome.storage.local.get("capture");
  await setCapture({ status: "uploading", total: (capture.total || 0) + jobs.length, error: "" });
  let sent = capture.sent || 0;
  const ids = new Set(capture.jobIds || []);
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const chunk = jobs.slice(i, i + BATCH_SIZE);
    await batchJobs(runId, chunk, true);
    sent += chunk.length;
    chunk.forEach((j) => ids.add(j.linkedin_job_id));
    await setCapture({ sent, jobIds: [...ids] });
  }
}

async function startRun({ newRun = false } = {}) {
  const { jobs, search_url } = await captureVisible();
  if (!jobs.length) throw new Error("No job cards found on this page");
  const capture = await ensureRun({ newRun, search_url });
  await uploadJobs(capture.runId, jobs);
  return setCapture({ status: "done" });
}

// ---- Deep capture + detail fetch (Task 6) ----
let deep = { tabId: null };
let detailRunning = false;
let stopRequested = false;

function assertIdle() {
  if (deep.tabId !== null || detailRunning) throw new Error("A deep capture or detail fetch is already running");
}

async function startDeepCapture({ maxJobs = 300, delayMs = 800 } = {}) {
  assertIdle();
  const tab = await activeLinkedInTab();
  const capture = await ensureRun({ search_url: tab.url });
  stopRequested = false;
  const res = await sendToTab(tab.id, { type: "DEEP_START", maxJobs: clampMaxJobs(maxJobs), delayMs: clampDeepDelay(delayMs) });
  if (!res || !res.ok) throw new Error((res && res.error) || "Could not start deep capture");
  deep.tabId = tab.id;
  return setCapture({ status: "deep_capturing", error: "", stopReason: "", runId: capture.runId });
}

async function fetchDetails({ jobIds, delayMs } = {}) {
  assertIdle();
  delayMs = clampDetailDelay(delayMs);
  const tab = await activeLinkedInTab();
  const { capture = {} } = await chrome.storage.local.get("capture");
  if (!capture.runId) throw new Error("Capture jobs first (no run yet)");
  const done = new Set(capture.detailDone || []);
  const ids = (jobIds && jobIds.length ? jobIds.map(String) : capture.jobIds || []).filter((id) => !done.has(id));
  if (!ids.length) throw new Error("No pending jobs to fetch details for");
  detailRunning = true;
  stopRequested = false;
  await setCapture({ status: "fetching_details", detailTotal: ids.length, detailSent: 0, error: "", stopReason: "" });
  // Fire and forget: progress flows through CAPTURE_PROGRESS.
  runDetailLoop(tab.id, capture.runId, ids, delayMs).finally(() => {
    detailRunning = false;
  });
  return { started: true, pending: ids.length };
}

async function runDetailLoop(tabId, runId, ids, delayMs) {
  let n = 0;
  let reason = "done";
  let failStreak = 0;
  try {
    for (const jobId of ids) {
      if (stopRequested) {
        reason = "stopped";
        break;
      }
      let res;
      try {
        res = await sendToTab(tabId, { type: "FETCH_DETAIL", jobId, delayMs });
      } catch (e) {
        res = { ok: false, error: String(e.message || e) };
      }
      if (res && res.blocked) {
        reason = "blocked";
        break;
      }
      const job = res && res.ok && res.detail_payload
        ? { linkedin_job_id: jobId, detail_payload: res.detail_payload }
        : buildDetailJob(jobId, null);
      await batchJobs(runId, [job], true);
      n += 1;
      const { capture = {} } = await chrome.storage.local.get("capture");
      const detailDone = job.detail_payload ? [...(capture.detailDone || []), jobId] : capture.detailDone || [];
      await setCapture({ detailSent: n, detailDone });
      failStreak = job.detail_payload ? 0 : failStreak + 1;
      if (failStreak >= MAX_CONSECUTIVE_DETAIL_FAILURES) {
        reason = "too_many_failures";
        break;
      }
      await sleep(delayMs);
    }
    await setCapture({ status: "done", stopReason: reason });
  } catch (e) {
    await setCapture({ status: "error", error: String(e.message || e) });
  }
}

const handlers = {
  async LOGIN({ apiBase, email, password }) {
    const base = normalizeBase(apiBase);
    const t = await login(base, email, password);
    await saveSettings({
      apiBase: base,
      email,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
    });
    await resetRun();
    return { ok: true };
  },
  async LOGOUT() {
    await logout();
    await resetRun();
    return { ok: true };
  },
  async GET_STATE() {
    const s = await getSettings();
    const { capture = {} } = await chrome.storage.local.get("capture");
    return {
      ok: true,
      apiBase: s.apiBase,
      studioUrl: s.studioUrl,
      email: s.email || "",
      loggedIn: Boolean(s.access_token),
      capture,
    };
  },
  async SAVE_SETTINGS({ settings }) {
    if (settings && Object.prototype.hasOwnProperty.call(settings, "apiBase")) {
      const current = await getSettings();
      if (normalizeBase(settings.apiBase) !== normalizeBase(current.apiBase)) {
        await resetRun();
      }
    }
    await saveSettings(settings);
    return { ok: true };
  },
  async CAPTURE_VISIBLE() {
    // Preview only: count visible cards without creating a run.
    const { jobs } = await captureVisible();
    return { ok: true, count: jobs.length };
  },
  START_RUN: (msg) =>
    enqueue(async () => {
      try {
        const capture = await startRun(msg);
        return { ok: true, capture };
      } catch (err) {
        await setCapture({ status: "error", error: String(err.message || err) });
        throw err;
      }
    }),
  async RESET_RUN() {
    await resetRun();
    return { ok: true };
  },
  async DEEP_CAPTURE(msg) {
    assertIdle();
    try {
      const capture = await startDeepCapture(msg);
      return { ok: true, capture };
    } catch (err) {
      await setCapture({ status: "error", error: String(err.message || err) });
      throw err;
    }
  },
  // Sent by the content script for each batch of newly seen cards.
  DEEP_BATCH: (msg) =>
    enqueue(async () => {
      const { capture = {} } = await chrome.storage.local.get("capture");
      if (!capture.runId) throw new Error("No active run");
      await uploadJobs(capture.runId, msg.jobs || []);
      await setCapture({ status: "deep_capturing" });
      return { ok: true };
    }),
  DEEP_DONE: (msg) =>
    enqueue(async () => {
      deep.tabId = null;
      if (msg.reason === "error") {
        await setCapture({ status: "error", error: msg.error || "Deep capture failed" });
      } else {
        await setCapture({
          status: msg.reason === "blocked" ? "blocked" : "done",
          stopReason: msg.reason,
          error: msg.reason === "blocked" ? "LinkedIn showed a checkpoint/CAPTCHA — solve it, then resume" : "",
        });
      }
      return { ok: true };
    }),
  async STOP() {
    stopRequested = true;
    if (deep.tabId === null && !detailRunning) {
      // Nothing live in this worker (e.g. it restarted): clear any stale busy status.
      const { capture = {} } = await chrome.storage.local.get("capture");
      if (["deep_capturing", "fetching_details"].includes(capture.status)) {
        await setCapture({ status: "done", stopReason: "stopped" });
      }
    }
    if (deep.tabId !== null) {
      try {
        await chrome.tabs.sendMessage(deep.tabId, { type: "STOP" });
      } catch {
        // Content script is gone (tab closed/navigated): release the lock ourselves.
        deep.tabId = null;
        await setCapture({ status: "done", stopReason: "stopped" });
      }
    }
    return { ok: true };
  },
  async FETCH_DETAILS(msg) {
    assertIdle();
    try {
      const r = await fetchDetails(msg);
      return { ok: true, ...r };
    } catch (err) {
      await setCapture({ status: "error", error: String(err.message || err) });
      throw err;
    }
  },
};

export { handlers };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg))
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
  return true;
});
