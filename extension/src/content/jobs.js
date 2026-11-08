// Classic content script (MV3 content scripts cannot use static ESM imports),
// so shared modules are loaded via dynamic import of web-accessible modules.
(() => {
  if (window.__outreachStudioJobsLoaded) return;
  window.__outreachStudioJobsLoaded = true;

  const mod = (name) => import(chrome.runtime.getURL(`src/lib/${name}.js`));
  const cache = {};
  const load = (name) => (cache[name] ||= mod(name));
  const loadAll = async () => {
    const [parse, detail, capture, selectors] = await Promise.all([
      load("parse"),
      load("detail"),
      load("capture"),
      load("selectors"),
    ]);
    return { parse, detail, capture, selectors };
  };
  const err = (e) => String((e && e.message) || e);

  let stopRequested = false;
  let deepRunning = false;

  const pageText = () => (document.body && document.body.innerText) || "";

  // Scroll the results list; if it cannot move further, click "next page".
  async function scrollOrNextPage(S, sleep) {
    const D = S.DETAIL_SELECTORS;
    const scroller = document.querySelector(D.listScroller);
    if (scroller) {
      const before = scroller.scrollTop;
      const h = scroller.scrollHeight;
      scroller.scrollTop = before + Math.max(scroller.clientHeight * 0.9, 400);
      await sleep(250);
      if (scroller.scrollTop > before || scroller.scrollHeight > h) return true;
    }
    const next = document.querySelector(D.nextPage);
    if (next && !next.disabled && next.getAttribute("aria-disabled") !== "true") {
      next.click();
      return true;
    }
    return false;
  }

  async function runDeepCapture({ maxJobs, delayMs }) {
    const { parse, capture, selectors } = await loadAll();
    const send = (m) => chrome.runtime.sendMessage(m);
    let result;
    try {
      result = await capture.deepCapture({
        maxJobs,
        delayMs,
        parse: () => parse.parseVisibleJobs(document, location.origin),
        shouldStop: () => stopRequested,
        isBlocked: () => capture.isBlockedPage(pageText(), location.href),
        scrollOrNextPage: () => scrollOrNextPage(selectors, capture.sleep),
        onBatch: async (jobs) => {
          const r = await send({ type: "DEEP_BATCH", jobs });
          if (!r || r.ok === false) throw new Error((r && r.error) || "Upload failed");
        },
      });
    } catch (e) {
      result = { count: 0, reason: "error", error: err(e) };
    }
    await send({ type: "DEEP_DONE", ...result }).catch(() => {});
  }

  // Open a job in the split pane (click its card), wait for it to render, read the description.
  async function fetchOne({ jobId, delayMs }) {
    const { parse, detail, capture, selectors } = await loadAll();
    const { sleep } = capture;
    if (capture.isBlockedPage(pageText(), location.href)) return { ok: true, blocked: true };

    const onThisJob = () => new RegExp(`currentJobId=${jobId}\\b|/jobs/view/(?:[^/?#]*-)?${jobId}\\b`).test(location.href);
    const before = detail.extractDetail(document);
    if (!onThisJob()) {
      const card = [...document.querySelectorAll(selectors.SELECTORS.jobCard)].find((c) => {
        const j = parse.parseJobCard(c, location.origin);
        return j && j.linkedin_job_id === jobId;
      });
      if (!card) return { ok: false, error: "Job card not in the page (scrolled out of the list?)" };
      card.scrollIntoView({ block: "center" });
      const link = card.querySelector(selectors.SELECTORS.link) || card;
      link.click();
    }
    // Wait for the pane to switch to this job and expose a description.
    const deadline = Date.now() + 10000;
    let d = null;
    while (Date.now() < deadline) {
      await sleep(300);
      d = detail.extractDetail(document);
      if (d && (onThisJob() || !before || d.description !== before.description)) break;
      d = null;
    }
    if (!d) return capture.isBlockedPage(pageText(), location.href)
      ? { ok: true, blocked: true }
      : { ok: false, error: "Description did not load" };
    const more = document.querySelector(selectors.DETAIL_SELECTORS.seeMore);
    if (more) {
      more.click();
      await sleep(Math.min(delayMs || 400, 600));
      d = detail.extractDetail(document) || d;
    }
    return { ok: true, detail_payload: detail.buildDetailJob(jobId, d).detail_payload };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === "CAPTURE_VISIBLE") {
      loadAll()
        .then(({ parse }) => {
          const jobs = parse.parseVisibleJobs(document, location.origin);
          sendResponse({ ok: true, jobs, search_url: location.href });
        })
        .catch((e) => sendResponse({ ok: false, error: err(e) }));
      return true; // async response
    }
    if (msg.type === "DEEP_START") {
      if (deepRunning) {
        sendResponse({ ok: false, error: "Deep capture already running" });
        return false;
      }
      deepRunning = true;
      stopRequested = false;
      // Respond immediately; progress flows back via DEEP_BATCH / DEEP_DONE messages.
      runDeepCapture({ maxJobs: msg.maxJobs, delayMs: msg.delayMs }).finally(() => {
        deepRunning = false;
      });
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === "STOP") {
      stopRequested = true;
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === "FETCH_DETAIL") {
      fetchOne(msg)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: err(e) }));
      return true;
    }
    return false;
  });
})();
