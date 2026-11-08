import {
  login,
  logout,
  getSettings,
  saveSettings,
  normalizeBase,
  createRun,
  batchJobs,
} from "./lib/api.js";

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

async function captureVisible() {
  const tab = await activeLinkedInTab();
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_VISIBLE" });
  } catch {
    // Tab was open before the extension loaded: inject the content script once.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content/jobs.js"] });
    res = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_VISIBLE" });
  }
  if (!res || !res.ok) throw new Error((res && res.error) || "Capture failed");
  return res; // { jobs, search_url }
}

async function startRun({ newRun = false } = {}) {
  const { jobs, search_url } = await captureVisible();
  if (!jobs.length) throw new Error("No job cards found on this page");
  let { capture = {} } = await chrome.storage.local.get("capture");
  if (newRun || !capture.runId) {
    await setCapture({ status: "creating_run", total: 0, sent: 0, error: "" });
    const run = await createRun({ search_url, search_query_snapshot: search_url });
    capture = await setCapture({ runId: run.id, total: 0, sent: 0 });
  }
  const total = (capture.total || 0) + jobs.length;
  await setCapture({ status: "uploading", total, error: "" });
  let sent = capture.sent || 0;
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const chunk = jobs.slice(i, i + BATCH_SIZE);
    await batchJobs(capture.runId, chunk, true);
    sent += chunk.length;
    await setCapture({ sent });
  }
  return setCapture({ status: "done", sent });
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
  // Task 6 stubs: deep capture / detail fetch not implemented yet.
  async DEEP_CAPTURE() {
    return { ok: false, error: "Deep capture is not implemented yet (Task 6)" };
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
