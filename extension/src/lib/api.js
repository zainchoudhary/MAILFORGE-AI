// API client + auth storage. Tokens live in chrome.storage.local.
const KEYS = ["apiBase", "studioUrl", "access_token", "refresh_token", "email"];

export const DEFAULTS = {
  apiBase: "http://localhost:8000",
  studioUrl: "http://localhost:8080",
};

export const normalizeBase = (u) => (u || "").trim().replace(/\/+$/, "");

export async function getSettings() {
  const s = await chrome.storage.local.get(KEYS);
  return { ...DEFAULTS, ...s };
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

export async function login(apiBase, email, password) {
  const res = await fetch(`${normalizeBase(apiBase)}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json(); // { access_token, refresh_token, token_type }
}

export async function logout() {
  await chrome.storage.local.remove(["access_token", "refresh_token"]);
}

async function errorText(res) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    if (typeof j.detail === "string") return j.detail;
    if (j.detail) return JSON.stringify(j.detail);
  } catch {}
  return text || `HTTP ${res.status}`;
}

// Single in-flight refresh shared by concurrent callers.
let refreshing = null;

export async function refreshTokens() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { apiBase, refresh_token } = await getSettings();
    if (!refresh_token) throw new Error("Not signed in");
    const res = await fetch(`${normalizeBase(apiBase)}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) {
      // Only drop the session on auth rejection — 5xx must not force a re-login.
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        await logout();
        throw new Error("Session expired — sign in again");
      }
      throw new Error(await errorText(res));
    }
    const t = await res.json();
    await saveSettings({
      access_token: t.access_token,
      refresh_token: t.refresh_token || refresh_token,
    });
    return t.access_token;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function apiFetch(path, options = {}) {
  const doFetch = async (token) => {
    const { apiBase } = await getSettings();
    return fetch(`${normalizeBase(apiBase)}/api/v1${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  };
  const { access_token } = await getSettings();
  if (!access_token) throw new Error("Not signed in");
  let res = await doFetch(access_token);
  if (res.status === 401) {
    res = await doFetch(await refreshTokens());
  }
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export function createRun({ search_url = "", search_query_snapshot = "" } = {}) {
  return apiFetch("/linkedin-capture/runs", {
    method: "POST",
    body: JSON.stringify({ search_url, search_query_snapshot }),
  });
}

export function batchJobs(runId, jobs, extract = true) {
  return apiFetch(`/linkedin-capture/runs/${encodeURIComponent(runId)}/jobs/batch`, {
    method: "POST",
    body: JSON.stringify({ jobs, extract }),
  });
}

export function studioRunUrl(studioUrl, runId) {
  return `${normalizeBase(studioUrl)}/lead-finder/linkedin?run=${encodeURIComponent(runId)}`;
}
