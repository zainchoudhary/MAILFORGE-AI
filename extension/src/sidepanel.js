import { normalizeBase, studioRunUrl } from "./lib/api.js";

const $ = (id) => document.getElementById(id);
const send = (msg) =>
  chrome.runtime.sendMessage(msg).then((r) => {
    if (!r || r.ok === false) throw new Error((r && r.error) || "Request failed");
    return r;
  });

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text || "";
  el.className = isError ? "error" : "";
}

function renderCapture(capture = {}, studioUrl) {
  $("progress").textContent = `Captured: ${capture.sent || 0} / ${capture.total || 0}`;
  const link = $("studioLink");
  if (capture.runId) {
    link.href = studioRunUrl(studioUrl || $("studioUrl").value, capture.runId);
    link.classList.remove("hidden");
  } else {
    link.classList.add("hidden");
  }
  if (capture.status === "error" && capture.error) setStatus(capture.error, true);
}

async function render() {
  const s = await send({ type: "GET_STATE" });
  $("apiBase").value = s.apiBase;
  $("studioUrl").value = s.studioUrl;
  if (s.email) $("email").value = s.email;
  $("authSection").classList.toggle("hidden", s.loggedIn);
  $("captureSection").classList.toggle("hidden", !s.loggedIn);
  $("who").textContent = s.email;
  renderCapture(s.capture, s.studioUrl);
}

// Request access to the configured API origin only (never a blanket grant).
async function ensureOriginPermission(apiBase) {
  const origin = new URL(normalizeBase(apiBase)).origin + "/*";
  if (await chrome.permissions.contains({ origins: [origin] })) return;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error(`Permission to reach ${origin} was denied`);
}

$("loginBtn").addEventListener("click", async () => {
  try {
    setStatus("Signing in…");
    const apiBase = normalizeBase($("apiBase").value);
    await ensureOriginPermission(apiBase); // must run inside the click gesture
    await send({ type: "SAVE_SETTINGS", settings: { studioUrl: normalizeBase($("studioUrl").value) } });
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

$("captureBtn").addEventListener("click", async () => {
  try {
    setStatus("Capturing…");
    $("captureBtn").disabled = true;
    await send({ type: "START_RUN" });
    setStatus("Captured visible jobs.");
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    $("captureBtn").disabled = false;
  }
});

$("newRunBtn").addEventListener("click", async () => {
  await send({ type: "RESET_RUN" });
  renderCapture({}, null);
  setStatus("Next capture will start a new run.");
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "CAPTURE_PROGRESS") renderCapture(msg.capture);
});

render().catch((e) => setStatus(e.message, true));
