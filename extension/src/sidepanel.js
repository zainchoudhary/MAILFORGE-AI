import { normalizeBase, normalizeStudioUrl, studioRunUrl } from "./lib/api.js";

const $ = (id) => document.getElementById(id);
const send = (msg) =>
  chrome.runtime.sendMessage(msg).then((r) => {
    if (!r || r.ok === false) throw new Error((r && r.error) || "Request failed");
    return r;
  });

let latestStudioUrl = "http://localhost:5173";
let latestRunId = "";
let latestEmails = 0;
let latestItems = 0;

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text || "";
  el.className = isError ? "error" : "";
}

function setAvatar(email) {
  const el = $("avatar");
  if (!el) return;
  const seed = String(email || "OS").trim();
  const letter = (seed[0] || "O").toUpperCase();
  el.textContent = /[A-Z0-9]/.test(letter) ? letter : "O";
}

function updateStats(emails, target, items) {
  latestEmails = Number(emails) || 0;
  latestItems = Number(items) || 0;
  if ($("statEmails")) $("statEmails").innerHTML = `${latestEmails} <em>/ ${target}</em>`;
  if ($("statItems")) $("statItems").textContent = String(latestItems);
  const fill = $("meterFill");
  if (fill) {
    const pct = Math.max(0, Math.min(100, Math.round((latestEmails / Math.max(1, target)) * 100)));
    fill.style.width = `${pct}%`;
  }
}

function renderCapture(capture = {}, studioUrl) {
  const emails = capture.emailsFound || 0;
  const target = capture.targetEmails || Number($("targetEmails").value) || 20;
  const items = capture.sent || capture.total || 0;
  const hunting =
    capture.status === "hunting" ||
    capture.status === "deep_capturing" ||
    capture.status === "navigating";

  if (studioUrl) latestStudioUrl = normalizeStudioUrl(studioUrl);
  latestRunId = capture.runId || "";
  updateStats(emails, target, items);

  if (capture.status === "navigating") {
    $("progress").textContent = `Opening LinkedIn search…`;
    setStatus(capture.keywords ? `Searching: ${capture.keywords}` : "Navigating to content search…");
  } else if (hunting) {
    $("progress").textContent = `Collecting… ${emails} / ${target} emails · ${items} posts`;
    setStatus("Keep the LinkedIn tab open. Scrolling search results…");
  } else if (capture.status === "done") {
    $("progress").textContent = `Done — ${emails} email${emails === 1 ? "" : "s"} from ${items} posts`;
    if (capture.stopReason === "target") setStatus("Target reached. Review leads in Studio.");
    else if (capture.stopReason) setStatus(`Stopped (${capture.stopReason}). ${emails} email(s) saved.`);
    else setStatus("Done. Open Studio to review.");
  } else if (capture.status === "blocked") {
    $("progress").textContent = `${emails} / ${target} emails`;
    setStatus(capture.error || "LinkedIn checkpoint — solve it, then Collect again", true);
  } else if (capture.status === "error") {
    setStatus(capture.error || "Something failed", true);
  } else {
    $("progress").textContent = items || emails ? `${emails} emails · ${items} posts` : "Ready to collect";
  }

  $("startBtn").disabled = hunting;
  const link = $("studioLink");
  if (capture.runId) {
    link.dataset.url = studioRunUrl(latestStudioUrl || $("studioUrl").value, capture.runId);
    link.classList.remove("hidden");
  } else {
    link.classList.add("hidden");
    delete link.dataset.url;
  }
}

async function openInStudio() {
  const studioBase = normalizeStudioUrl($("studioUrl").value || latestStudioUrl || "http://localhost:5173");
  $("studioUrl").value = studioBase;
  await send({ type: "SAVE_SETTINGS", settings: { studioUrl: studioBase } });
  latestStudioUrl = studioBase;
  const url = latestRunId
    ? studioRunUrl(studioBase, latestRunId)
    : `${studioBase}/lead-finder/linkedin`;
  // Side panel <a target="_blank"> is unreliable in Chrome MV3 — open a real tab.
  await chrome.tabs.create({ url, active: true });
}

async function render() {
  const s = await send({ type: "GET_STATE" });
  $("apiBase").value = s.apiBase;
  $("studioUrl").value = normalizeStudioUrl(s.studioUrl);
  latestStudioUrl = normalizeStudioUrl(s.studioUrl || "http://localhost:5173");
  if (s.email) $("email").value = s.email;
  if (s.capture?.targetEmails) $("targetEmails").value = s.capture.targetEmails;
  if (s.capture?.keywords) $("keywords").value = s.capture.keywords;
  $("authSection").classList.toggle("hidden", s.loggedIn);
  $("captureSection").classList.toggle("hidden", !s.loggedIn);
  $("who").textContent = s.email || "";
  setAvatar(s.email || "");
  renderCapture(s.capture, s.studioUrl);
}

async function ensureOriginPermission(apiBase) {
  const origin = new URL(normalizeBase(apiBase)).origin + "/*";
  if (await chrome.permissions.contains({ origins: [origin] })) return;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error(`Permission to reach ${origin} was denied`);
}

$("loginBtn").addEventListener("click", async () => {
  try {
    setStatus("Signing in…");
    const apiBase = normalizeBase($("apiBase").value || "http://localhost:8000");
    await ensureOriginPermission(apiBase);
    const studioUrl = normalizeStudioUrl($("studioUrl").value || "http://localhost:5173");
    $("studioUrl").value = studioUrl;
    await send({
      type: "SAVE_SETTINGS",
      settings: { studioUrl },
    });
    await send({ type: "LOGIN", apiBase, email: $("email").value.trim(), password: $("password").value });
    $("password").value = "";
    setStatus("");
    await render();
  } catch (e) {
    setStatus(e.message, true);
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await send({ type: "LOGOUT" });
  await render();
});

$("startBtn").addEventListener("click", async () => {
  try {
    const keywords = ($("keywords").value || "").trim();
    const targetEmails = Math.max(1, Math.min(500, Number($("targetEmails").value) || 20));
    if (!keywords) {
      setStatus("Enter search keywords first", true);
      return;
    }
    setStatus("Starting LinkedIn content search…");
    $("startBtn").disabled = true;
    const studioUrl = normalizeStudioUrl($("studioUrl").value || "http://localhost:5173");
    $("studioUrl").value = studioUrl;
    await send({
      type: "SAVE_SETTINGS",
      settings: { studioUrl },
    });
    await send({
      type: "SMART_COLLECT",
      keywords,
      targetEmails,
      delayMs: 1100,
    });
  } catch (e) {
    setStatus(e.message, true);
    $("startBtn").disabled = false;
  }
});

$("stopBtn").addEventListener("click", async () => {
  try {
    await send({ type: "STOP" });
    setStatus("Stopping…");
  } catch (e) {
    setStatus(e.message, true);
  }
});

$("newRunBtn").addEventListener("click", async () => {
  await send({ type: "RESET_RUN" });
  latestRunId = "";
  renderCapture({}, latestStudioUrl);
  updateStats(0, Number($("targetEmails").value) || 20, 0);
  setStatus("Next Collect creates a new run.");
});

$("targetEmails").addEventListener("input", () => {
  updateStats(latestEmails, Number($("targetEmails").value) || 20, latestItems);
});

$("studioLink").addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    await openInStudio();
  } catch (e) {
    setStatus(e.message || "Could not open Studio", true);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "CAPTURE_PROGRESS") renderCapture(msg.capture, latestStudioUrl);
});

render().catch((e) => setStatus(e.message, true));
