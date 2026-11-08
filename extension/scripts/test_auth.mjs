// Auth / run-state tests: mock chrome.storage + fetch, then exercise the real modules.
import assert from "node:assert/strict";

const store = {};
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onMessage: { addListener() {} },
    sendMessage: async () => {},
  },
  sidePanel: { setPanelBehavior: async () => {} },
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

const { refreshTokens } = await import("../src/lib/api.js");
const { handlers } = await import("../src/background.js");

function seedSession(extra = {}) {
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, {
    apiBase: "http://localhost:8000",
    access_token: "access-old",
    refresh_token: "refresh-old",
    email: "user@example.com",
    capture: { runId: "run-stale", sent: 7, total: 12, status: "done" },
    ...extra,
  });
}

function jsonOk(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function httpErr(status, text = `HTTP ${status}`) {
  return { ok: false, status, json: async () => ({}), text: async () => text };
}

// --- refreshTokens: wipe session only on auth failures ---
{
  seedSession();
  globalThis.fetch = async () => httpErr(500, "upstream down");
  await assert.rejects(() => refreshTokens(), /./);
  assert.equal(store.refresh_token, "refresh-old", "5xx must not clear refresh_token");
  assert.equal(store.access_token, "access-old", "5xx must not clear access_token");
}

{
  seedSession();
  globalThis.fetch = async () => httpErr(502, "bad gateway");
  await assert.rejects(() => refreshTokens(), /./);
  assert.equal(store.refresh_token, "refresh-old", "502 must not clear tokens");
}

{
  seedSession();
  globalThis.fetch = async () => httpErr(401, "invalid refresh");
  await assert.rejects(() => refreshTokens(), /Session expired/);
  assert.equal(store.refresh_token, undefined, "401 must clear refresh_token");
  assert.equal(store.access_token, undefined, "401 must clear access_token");
}

{
  seedSession();
  globalThis.fetch = async () => httpErr(403, "forbidden");
  await assert.rejects(() => refreshTokens(), /Session expired/);
  assert.equal(store.refresh_token, undefined, "403 must clear tokens");
}

{
  seedSession();
  globalThis.fetch = async () => httpErr(400, "bad refresh");
  await assert.rejects(() => refreshTokens(), /Session expired/);
  assert.equal(store.refresh_token, undefined, "400 must clear tokens");
}

// --- LOGIN / LOGOUT / SAVE_SETTINGS clear stale capture ---
{
  seedSession();
  globalThis.fetch = async () => jsonOk({ access_token: "access-new", refresh_token: "refresh-new" });
  const r = await handlers.LOGIN({
    apiBase: "http://localhost:8000",
    email: "user@example.com",
    password: "secret",
  });
  assert.equal(r.ok, true);
  assert.equal(store.capture, undefined, "successful LOGIN must clear capture run state");
}

{
  seedSession();
  const r = await handlers.LOGOUT();
  assert.equal(r.ok, true);
  assert.equal(store.capture, undefined, "LOGOUT must clear capture run state");
  assert.equal(store.access_token, undefined);
}

{
  seedSession();
  const r = await handlers.RESET_RUN();
  assert.equal(r.ok, true);
  assert.equal(store.capture, undefined, "RESET_RUN still clears capture");
}

{
  seedSession();
  const r = await handlers.SAVE_SETTINGS({ settings: { apiBase: "http://127.0.0.1:9000" } });
  assert.equal(r.ok, true);
  assert.equal(store.capture, undefined, "apiBase change must clear capture run state");
}

{
  seedSession();
  await handlers.SAVE_SETTINGS({ settings: { studioUrl: "http://localhost:8081" } });
  assert.deepEqual(store.capture, { runId: "run-stale", sent: 7, total: 12, status: "done" });
}

console.log("auth tests passed (refresh 5xx keeps session; LOGIN/LOGOUT/apiBase reset capture)");
