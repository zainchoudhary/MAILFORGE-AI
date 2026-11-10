import {
  login,
  logout,
  getSettings,
  saveSettings,
  normalizeBase,
  createRun,
  batchJobs,
  getRun,
  listPendingJobs,
} from "./lib/api.js";
import { buildDetailJob } from "./lib/detail.js";
import { copyPostLinkInPage } from "./lib/postLink.js";
import { sleep } from "./lib/capture.js";
import { clampMaxJobs, clampDeepDelay, clampDetailDelay, MAX_CONSECUTIVE_DETAIL_FAILURES } from "./lib/limits.js";
import {
  processKeywords,
  buildContentSearchUrl,
  detectCollectionContext,
  isLinkedInUrl,
} from "./lib/searchCollect.js";

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

async function activeLinkedInTab({ jobsOnly = false, optional = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";
  if (!tab || !/^https:\/\/www\.linkedin\.com\//.test(url)) {
    if (optional) return null;
    throw new Error("Open a LinkedIn tab first (feed, post, or Jobs search)");
  }
  if (jobsOnly && !/\/jobs\//.test(url)) {
    throw new Error("Deep jobs capture needs a LinkedIn Jobs search tab");
  }
  return tab;
}

async function findLinkedInTab(windowId) {
  const query = { url: ["https://www.linkedin.com/*", "https://linkedin.com/*"] };
  if (windowId != null) query.windowId = windowId;
  else query.lastFocusedWindow = true;
  const tabs = await chrome.tabs.query(query);
  if (!tabs?.length) return null;
  return tabs.find((t) => t.active) || tabs[tabs.length - 1];
}

function waitTabComplete(tabId, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("LinkedIn took too long to load"));
    }, timeoutMs);
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }).catch(() => {});
  });
}

async function waitSearchReady(tabId, processedKeywords, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let pollCount = 0;
  while (Date.now() < deadline) {
    pollCount += 1;
    try {
      const res = await sendToTab(tabId, {
        type: "CHECK_SEARCH_READY",
        processedKeywords,
        pollCount,
      });
      if (res?.ready) return true;
    } catch {
      /* content script may still be injecting */
    }
    await sleep(1500);
  }
  throw new Error("LinkedIn search page did not become ready");
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
  const res = await sendToTab(tab.id, { type: "CAPTURE_PAGE" });
  if (!res || !res.ok) throw new Error((res && res.error) || "Capture failed");
  return res; // { jobs, search_url, kind }
}

function isCancelledRunError(err) {
  const msg = String((err && err.message) || err || "");
  return Boolean(err && err.status === 409 && /cancelled run cannot accept/i.test(msg));
}

async function runStillOpen(runId) {
  if (!runId) return false;
  try {
    const run = await getRun(runId);
    return Boolean(run && run.status && run.status !== "cancelled");
  } catch {
    return false;
  }
}

async function ensureRun({ newRun = false, search_url = "" } = {}) {
  let { capture = {} } = await chrome.storage.local.get("capture");
  let reuse = !newRun && Boolean(capture.runId);
  if (reuse && !(await runStillOpen(capture.runId))) {
    // Studio cancel (or deleted run) — do not keep posting batches to a dead runId.
    reuse = false;
  }
  if (!reuse) {
    await setCapture({
      status: "creating_run",
      total: 0,
      sent: 0,
      jobIds: [],
      detailDone: [],
      error: "",
      stopReason: "",
    });
    const run = await createRun({ search_url, search_query_snapshot: search_url });
    capture = await setCapture({ runId: run.id, total: 0, sent: 0 });
  }
  return capture;
}

// Upload list jobs in chunks, tracking totals and captured ids (for later detail fetch).
async function uploadJobs(runId, jobs) {
  let { capture = {} } = await chrome.storage.local.get("capture");
  let activeRunId = runId || capture.runId;
  if (!activeRunId) throw new Error("No active run");
  await setCapture({ status: "uploading", total: (capture.total || 0) + jobs.length, error: "" });
  let sent = capture.sent || 0;
  const ids = new Set(capture.jobIds || []);
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const chunk = jobs.slice(i, i + BATCH_SIZE);
    try {
      await batchJobs(activeRunId, chunk, true); // retries network errors / 5xx internally
    } catch (e) {
      if (isCancelledRunError(e)) {
        // Run was cancelled in Studio mid-hunt — open a fresh run and continue this batch.
        const next = await ensureRun({
          newRun: true,
          search_url: capture.searchUrl || capture.search_url || "",
        });
        activeRunId = next.runId;
        sent = 0;
        ids.clear();
        try {
          await batchJobs(activeRunId, chunk, true);
        } catch (retryErr) {
          const msg = `Upload failed after retries (${sent} of ${jobs.length} sent): ${String(retryErr.message || retryErr)}`;
          await setCapture({ sent, jobIds: [...ids], status: "error", error: msg });
          throw new Error(msg);
        }
      } else {
        const msg = `Upload failed after retries (${sent} of ${jobs.length} sent): ${String(e.message || e)}`;
        await setCapture({ sent, jobIds: [...ids], status: "error", error: msg });
        throw new Error(msg);
      }
    }
    sent += chunk.length;
    chunk.forEach((j) => ids.add(j.linkedin_job_id));
    await setCapture({ sent, jobIds: [...ids], runId: activeRunId });
  }
  return activeRunId;
}

async function startRun({ newRun = false } = {}) {
  const { jobs, search_url, kind } = await captureVisible();
  if (!jobs.length) {
    throw new Error(
      kind === "jobs"
        ? "No job cards found — scroll the Jobs list so cards are visible, then try again"
        : "No posts found on this page — open your feed or a post thread and try again"
    );
  }
  const capture = await ensureRun({ newRun, search_url });
  await uploadJobs(capture.runId, jobs);
  // Posts already include detail_payload; refresh candidate count from the run if available.
  let emailsFound;
  try {
    const run = await getRun(capture.runId);
    emailsFound = run?.candidate_count ?? run?.progress?.candidates_kept;
  } catch {
    emailsFound = undefined;
  }
  return setCapture({ status: "done", kind: kind || "page", emailsFound });
}

async function emailsForRun(runId) {
  try {
    const run = await getRun(runId);
    return Number(run?.candidate_count ?? run?.progress?.candidates_kept ?? 0) || 0;
  } catch {
    return 0;
  }
}

// ---- Auto hunt (scroll until N emails) + deep jobs + detail fetch ----
let deep = { tabId: null };
let detailRunning = false;
let stopRequested = false;

function assertIdle() {
  if (deep.tabId !== null || detailRunning) throw new Error("Already running — press Stop first");
}

/** Lead Finder–style: scroll LinkedIn until we have targetEmails extracted leads. */
async function startAutoHunt({
  targetEmails = 20,
  delayMs = 1100,
  maxItems = 500,
  tabId = null,
  searchUrl = "",
  keywords = "",
  newRun = false,
} = {}) {
  assertIdle();
  let tab;
  if (tabId != null) {
    tab = await chrome.tabs.get(tabId);
  } else {
    tab = await activeLinkedInTab();
  }
  const target = Math.max(1, Math.min(500, Number(targetEmails) || 20));
  // Collect / keyword hunts always start a fresh Studio run so a cancelled runId is never reused.
  const capture = await ensureRun({
    newRun: newRun || Boolean(keywords),
    search_url: searchUrl || tab.url || "",
  });
  stopRequested = false;
  // Scan far more posts than the email target — public @ addresses are sparse.
  const huntCap = clampMaxJobs(Math.max(maxItems, target * 100, 2000));
  const res = await sendToTab(tab.id, {
    type: "HUNT_START",
    targetEmails: target,
    delayMs: Math.max(clampDeepDelay(delayMs), 1100),
    maxItems: huntCap,
  });
  if (!res || !res.ok) throw new Error((res && res.error) || "Could not start");
  deep.tabId = tab.id;
  return setCapture({
    status: "hunting",
    error: "",
    stopReason: "",
    runId: capture.runId,
    targetEmails: target,
    emailsFound: 0,
    sent: capture.sent || 0,
    total: capture.total || 0,
    keywords: keywords || "",
    searchUrl: searchUrl || tab.url || "",
  });
}

/**
 * ReachIn-style smart collect:
 * keywords → LinkedIn content search → wait for results → auto-scroll + extract → Studio sync.
 */
async function startSmartCollect({
  keywords = "",
  targetEmails = 20,
  delayMs = 1100,
  maxItems = 500,
  windowId = null,
} = {}) {
  assertIdle();
  const processed = processKeywords(keywords);
  if (!processed) throw new Error("Enter search keywords (comma-separated)");

  const searchUrl = buildContentSearchUrl(processed);
  const target = Math.max(1, Math.min(500, Number(targetEmails) || 20));

  await setCapture({
    status: "navigating",
    error: "",
    stopReason: "",
    keywords: String(keywords).trim(),
    searchUrl,
    targetEmails: target,
    emailsFound: 0,
  });

  let tab = await activeLinkedInTab({ optional: true });
  let url = tab?.url || "";
  if (!isLinkedInUrl(url)) {
    const existing = await findLinkedInTab(windowId);
    if (existing) {
      tab = existing;
      url = existing.url || "";
    }
  }

  const context = detectCollectionContext(url, processed);
  let tabId;

  if (context === "offLinkedIn") {
    const created = await chrome.tabs.create({ url: searchUrl, active: true });
    tabId = created.id;
    await waitTabComplete(tabId);
  } else if (context === "linkedInOther" || context === "searchMismatch") {
    tabId = tab.id;
    await chrome.tabs.update(tabId, { url: searchUrl, active: true });
    await waitTabComplete(tabId);
  } else {
    tabId = tab.id;
    await chrome.tabs.update(tabId, { active: true });
  }

  await waitSearchReady(tabId, processed);
  // Small settle delay so LinkedIn finishes hydrating cards (ReachIn uses ~1.5s).
  await sleep(1500);

  return startAutoHunt({
    targetEmails: target,
    delayMs,
    maxItems,
    tabId,
    searchUrl,
    keywords: String(keywords).trim(),
    newRun: true,
  });
}

async function startDeepCapture({ maxJobs = 300, delayMs = 800 } = {}) {
  assertIdle();
  const tab = await activeLinkedInTab({ jobsOnly: true });
  const capture = await ensureRun({ search_url: tab.url });
  stopRequested = false;
  const res = await sendToTab(tab.id, { type: "DEEP_START", maxJobs: clampMaxJobs(maxJobs), delayMs: clampDeepDelay(delayMs) });
  if (!res || !res.ok) throw new Error((res && res.error) || "Could not start deep capture");
  deep.tabId = tab.id;
  return setCapture({ status: "deep_capturing", error: "", stopReason: "", runId: capture.runId });
}

// Jobs Studio marked pending (its "Fetch job details" button). Empty on any API/network error.
async function serverPendingIds(runId) {
  try {
    const res = await listPendingJobs(runId);
    return (res.items || []).map((j) => String(j.linkedin_job_id)).filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchDetails({ jobIds, delayMs, fromStudio = false } = {}) {
  assertIdle();
  delayMs = clampDetailDelay(delayMs);
  const tab = await activeLinkedInTab();
  const { capture = {} } = await chrome.storage.local.get("capture");
  if (!capture.runId) throw new Error("Capture jobs first (no run yet)");
  const done = new Set(capture.detailDone || []);
  let ids;
  if (jobIds && jobIds.length) {
    ids = jobIds.map(String).filter((id) => fromStudio || !done.has(id));
  } else {
    // Blank = everything still pending locally PLUS whatever Studio re-requested (even if we
    // already scraped it once, Studio flips it back to pending).
    const local = (capture.jobIds || []).filter((id) => !done.has(id));
    ids = [...new Set([...(await serverPendingIds(capture.runId)), ...local])];
  }
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

// Studio "Fetch job details" only marks jobs pending on the server; this picks them up.
// Runs from a chrome.alarms tick (~30s) and is a no-op unless the extension is idle, signed in,
// has an active run Studio asked details for, and a LinkedIn Jobs tab is active.
const SKIP_POLL_REASONS = ["stopped", "blocked", "too_many_failures"];
async function pollPendingDetails() {
  if (deep.tabId !== null || detailRunning) return { started: false, reason: "busy" };
  const { capture = {} } = await chrome.storage.local.get("capture");
  if (!capture.runId) return { started: false, reason: "no_run" };
  if (["creating_run", "uploading", "navigating", "deep_capturing", "hunting", "fetching_details", "blocked"].includes(capture.status)) {
    return { started: false, reason: "not_idle" };
  }
  if (SKIP_POLL_REASONS.includes(capture.stopReason)) return { started: false, reason: capture.stopReason };
  try {
    const run = await getRun(capture.runId);
    if (!run || !run.progress || !run.progress.details_requested || run.status === "cancelled") {
      return { started: false, reason: "not_requested" };
    }
    const ids = await serverPendingIds(capture.runId);
    if (!ids.length) return { started: false, reason: "none_pending" };
    const r = await fetchDetails({ jobIds: ids, fromStudio: true });
    return { ...r, reason: "started" };
  } catch (e) {
    // Signed out, offline, or no LinkedIn tab active: try again next tick.
    return { started: false, reason: String((e && e.message) || e) };
  }
}

if (typeof chrome !== "undefined" && chrome.alarms) {
  chrome.alarms.create("poll-pending-details", { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "poll-pending-details") enqueue(pollPendingDetails).catch(() => {});
  });
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
      const runId = await uploadJobs(capture.runId, msg.jobs || []);
      const emailsFound = await emailsForRun(runId);
      await setCapture({ status: "deep_capturing", emailsFound, runId });
      return { ok: true, emailsFound };
    }),
  HUNT_BATCH: (msg) =>
    enqueue(async () => {
      const { capture = {} } = await chrome.storage.local.get("capture");
      if (!capture.runId) throw new Error("No active run");
      const runId = await uploadJobs(capture.runId, msg.jobs || []);
      const emailsFound = await emailsForRun(runId);
      await setCapture({ status: "hunting", emailsFound, runId });
      return { ok: true, emailsFound };
    }),
  DEEP_DONE: (msg) =>
    enqueue(async () => {
      deep.tabId = null;
      const { capture = {} } = await chrome.storage.local.get("capture");
      const emailsFound = capture.runId ? await emailsForRun(capture.runId) : capture.emailsFound || 0;
      if (msg.reason === "error") {
        await setCapture({ status: "error", error: msg.error || "Deep capture failed", emailsFound });
      } else {
        await setCapture({
          status: msg.reason === "blocked" ? "blocked" : "done",
          stopReason: msg.reason,
          emailsFound,
          error: msg.reason === "blocked" ? "LinkedIn showed a checkpoint/CAPTCHA — solve it, then Start again" : "",
        });
      }
      return { ok: true };
    }),
  HUNT_DONE: (msg) =>
    enqueue(async () => {
      deep.tabId = null;
      const { capture = {} } = await chrome.storage.local.get("capture");
      const emailsFound =
        Number(msg.emails) ||
        (capture.runId ? await emailsForRun(capture.runId) : 0) ||
        capture.emailsFound ||
        0;
      if (msg.reason === "error") {
        await setCapture({ status: "error", error: msg.error || "Hunt failed", emailsFound });
      } else {
        await setCapture({
          status: msg.reason === "blocked" ? "blocked" : "done",
          stopReason: msg.reason,
          emailsFound,
          error: msg.reason === "blocked" ? "LinkedIn checkpoint — solve it, then Start again" : "",
        });
      }
      return { ok: true };
    }),
  async AUTO_HUNT(msg) {
    assertIdle();
    try {
      // Prefer ReachIn-style content search when keywords are provided.
      if (msg?.keywords && String(msg.keywords).trim()) {
        const capture = await startSmartCollect(msg);
        return { ok: true, capture };
      }
      const capture = await startAutoHunt(msg);
      return { ok: true, capture };
    } catch (err) {
      await setCapture({ status: "error", error: String(err.message || err) });
      throw err;
    }
  },
  async SMART_COLLECT(msg) {
    assertIdle();
    try {
      const capture = await startSmartCollect(msg);
      return { ok: true, capture };
    } catch (err) {
      await setCapture({ status: "error", error: String(err.message || err) });
      throw err;
    }
  },
  async STOP() {
    stopRequested = true;
    if (deep.tabId === null && !detailRunning) {
      // Nothing live in this worker (e.g. it restarted): clear any stale busy status.
      const { capture = {} } = await chrome.storage.local.get("capture");
      if (["navigating", "deep_capturing", "hunting", "fetching_details"].includes(capture.status)) {
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
  POLL_PENDING: () => enqueue(pollPendingDetails).then((r) => ({ ok: true, ...r })),
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
  if (msg?.type === 'COPY_POST_LINK') {
    if (!_sender.tab?.id || !/^https:\/\/www\.linkedin\.com\//.test(_sender.url || '')) {
      sendResponse({ ok: false, url: '' });
      return false;
    }
    chrome.scripting.executeScript({
      target: { tabId: _sender.tab.id, frameIds: [_sender.frameId || 0] },
      world: 'MAIN',
      func: copyPostLinkInPage,
      args: [msg.token, msg.email],
    }).then((results) => sendResponse({ ok: true, url: results[0]?.result || '' }))
      .catch(() => sendResponse({ ok: false, url: '' }));
    return true;
  }
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg))
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
  return true;
});
