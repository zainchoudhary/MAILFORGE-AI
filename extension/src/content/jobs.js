// Classic content script (MV3 content scripts cannot use static ESM imports),
// so shared modules are loaded via dynamic import of web-accessible modules.
(() => {
  if (window.__outreachStudioJobsLoaded) return;
  window.__outreachStudioJobsLoaded = true;

  const mod = (name) => import(chrome.runtime.getURL(`src/lib/${name}.js`));
  const cache = {};
  const load = (name) => (cache[name] ||= mod(name));
  const loadAll = async () => {
    const [parse, posts, detail, capture, selectors, searchCollect] = await Promise.all([
      load("parse"),
      load("posts"),
      load("detail"),
      load("capture"),
      load("selectors"),
      load("searchCollect"),
    ]);
    return { parse, posts, detail, capture, selectors, searchCollect };
  };
  const err = (e) => String((e && e.message) || e);

  let stopRequested = false;
  let deepRunning = false;

  const blocked = (capture) => capture.isBlockedPage(location.href, document);

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

  async function scrollFeed(sleep, postsMod) {
    // ReachIn: content search scrolls `<main>`, not window. Expand truncated posts first.
    if (postsMod?.expandAllSeeMore) postsMod.expandAllSeeMore(document);

    const cardSel =
      ".feed-shared-update-v2, .occludable-update, div[data-urn*='activity:'], [data-chameleon-result-urn]";
    const beforeCount = document.querySelectorAll(cardSel).length;
    const beforeDocH = document.documentElement.scrollHeight;

    const roots = [
      document.querySelector("main"),
      document.querySelector(".scaffold-finite-scroll__content"),
      document.querySelector(".scaffold-layout__main"),
      document.querySelector("main.scaffold-layout__main"),
      document.querySelector('[role="main"]'),
      document.querySelector(".application-outlet"),
      document.scrollingElement,
      document.documentElement,
    ].filter(Boolean);

    let moved = false;
    for (const el of roots) {
      const isWindow = el === document.documentElement || el === document.scrollingElement;
      const beforeTop = isWindow ? window.scrollY : el.scrollTop;
      const beforeH = el.scrollHeight || document.documentElement.scrollHeight;
      const step = Math.max((el.clientHeight || window.innerHeight) * 0.95, 500);
      if (isWindow) window.scrollBy(0, step);
      else {
        if (typeof el.scrollBy === "function") el.scrollBy(0, step);
        else el.scrollTop = beforeTop + step;
        el.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
      await sleep(700);
      if (postsMod?.expandAllSeeMore) postsMod.expandAllSeeMore(document);
      const afterTop = isWindow ? window.scrollY : el.scrollTop;
      const afterH = el.scrollHeight || document.documentElement.scrollHeight;
      if (afterTop > beforeTop + 25 || afterH > beforeH + 25) {
        moved = true;
        break;
      }
    }

    // Nudge last card + small bounce (up then down) to re-trigger LinkedIn infinite scroll.
    const cards = document.querySelectorAll(cardSel);
    const main = document.querySelector("main");
    if (cards.length) {
      cards[cards.length - 1].scrollIntoView({ block: "end", behavior: "instant" });
      await sleep(800);
      if (postsMod?.expandAllSeeMore) postsMod.expandAllSeeMore(document);
      window.scrollBy(0, 450);
      if (main && typeof main.scrollBy === "function") main.scrollBy(0, 450);
      await sleep(600);
      // Bounce: scroll up slightly then back down — LinkedIn often stalls at absolute bottom.
      window.scrollBy(0, -280);
      if (main && typeof main.scrollBy === "function") main.scrollBy(0, -280);
      await sleep(400);
      window.scrollBy(0, 500);
      if (main && typeof main.scrollBy === "function") main.scrollBy(0, 500);
      await sleep(800);
    }

    const afterCount = document.querySelectorAll(cardSel).length;
    const afterDocH = document.documentElement.scrollHeight;
    if (afterCount > beforeCount || afterDocH > beforeDocH + 40) return true;
    return moved;
  }

  function emailsAlreadyInItems(items) {
    const set = new Set();
    const re = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    for (const item of items) {
      const blob = `${item.detail_payload?.description || ""} ${item.list_payload?.preview || ""}`;
      for (const m of blob.match(re) || []) set.add(m.toLowerCase());
    }
    return set;
  }

  function parsePage(parse, posts, searchCollect) {
    const onJobs = /\/jobs\//.test(location.pathname);
    const onContentSearch = /\/search\/results\/content/i.test(location.pathname);
    if (posts.expandAllSeeMore) posts.expandAllSeeMore(document);

    let items = onJobs
      ? parse.parseVisibleJobs(document, location.origin)
      : posts.parseVisiblePosts(document, location.origin);
    if (!items.length) {
      items = onJobs
        ? posts.parseVisiblePosts(document, location.origin)
        : parse.parseVisibleJobs(document, location.origin);
    }

    // ReachIn-style page sweep: any visible @ not already in a post card still gets uploaded.
    if (!onJobs && searchCollect?.extractEmailsFromDocument) {
      const pageEmails = searchCollect.extractEmailsFromDocument(document);
      const known = emailsAlreadyInItems(items);
      const missing = pageEmails.filter((e) => !known.has(e));
      if (missing.length) {
        const keywords = searchCollect.getUrlSearchKeywords?.(location.href) || "";
        const cardSel =
          ".feed-shared-update-v2, .occludable-update, div[data-urn*='activity:'], div[data-urn*='ugcPost:'], [data-chameleon-result-urn]";
        const urlForEmail = (email) => {
          const needle = String(email || "").toLowerCase();
          if (!needle || !posts.postUrl) return "";
          for (const card of document.querySelectorAll(cardSel)) {
            if (!(card.innerText || "").toLowerCase().includes(needle)) continue;
            const url = posts.postUrl(card, location.origin);
            if (url && !posts.isSearchOrListUrl?.(url)) return url;
          }
          return "";
        };
        items = items.concat(
          searchCollect.emailsAsSyntheticPosts(missing, {
            base: "",
            keywords,
            urlForEmail,
          })
        );
      }
    }

    void onContentSearch;
    return items;
  }

  function isSearchDomReady() {
    const loaders = document.querySelectorAll(
      '.artdeco-loader, [aria-label="Loading"], .search-results__loader, .search-results__loader-state'
    );
    const hasVisibleLoader = [...loaders].some(
      (el) => el.offsetParent !== null || el.getClientRects().length > 0
    );
    if (hasVisibleLoader) return false;

    const resultSelectors = [
      ".feed-shared-update-v2",
      "[data-chameleon-result-urn]",
      ".reusable-search__result-container",
      ".search-marvel-srp",
      ".entity-result",
      "main article",
      "main [data-urn]",
      ".update-components-actor",
    ];
    for (const sel of resultSelectors) {
      if (document.querySelector(sel)) return true;
    }
    if (document.querySelector(".search-no-results-placeholder, .search-reusables__no-results")) {
      return true;
    }
    const main = document.querySelector("main");
    return Boolean(main && main.innerText.trim().length > 50);
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
        isBlocked: () => blocked(capture),
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

  /** Auto-scroll until server reports enough extracted emails (Lead Finder–style). */
  async function runHunt({ targetEmails, delayMs, maxItems }) {
    const { parse, posts, capture, selectors, searchCollect } = await loadAll();
    const send = (m) => chrome.runtime.sendMessage(m);
    const onJobs = /\/jobs\//.test(location.pathname);
    let result;
    try {
      result = await capture.huntLeads({
        targetEmails,
        maxItems,
        delayMs,
        parse: () => parsePage(parse, posts, searchCollect),
        shouldStop: () => stopRequested,
        isBlocked: () => blocked(capture),
        scrollOrNextPage: () =>
          onJobs
            ? scrollOrNextPage(selectors, capture.sleep)
            : scrollFeed(capture.sleep, posts),
        onBatch: async (items) => {
          // On Jobs pages, enrich a few cards with detail text so emails can be extracted.
          if (onJobs) {
            for (const item of items.slice(0, 3)) {
              if (item.detail_payload?.description) continue;
              try {
                const d = await fetchOne({ jobId: item.linkedin_job_id, delayMs });
                if (d?.ok && d.detail_payload) {
                  item.detail_payload = d.detail_payload;
                  item.detail_status = "fetched";
                }
              } catch {
                /* keep going */
              }
              if (stopRequested) break;
            }
          }
          const r = await send({ type: "HUNT_BATCH", jobs: items });
          if (!r || r.ok === false) throw new Error((r && r.error) || "Upload failed");
          return { emailsFound: r.emailsFound || 0 };
        },
      });
    } catch (e) {
      result = { count: 0, emails: 0, reason: "error", error: err(e) };
    }
    await send({ type: "HUNT_DONE", ...result }).catch(() => {});
  }

  // Open a job in the split pane (click its card), wait for it to render, read the description.
  async function fetchOne({ jobId, delayMs }) {
    const { parse, detail, capture, selectors } = await loadAll();
    const { sleep } = capture;
    if (blocked(capture)) return { ok: true, blocked: true };

    const onThisJob = () => new RegExp(`currentJobId=${jobId}\\b|/jobs/view/(?:[^/?#]*-)?${jobId}\\b`).test(location.href);
    const before = detail.extractDetail(document);
    // The URL can already name this job while the pane still shows the previous one, so a URL
    // match alone is never enough once we had to click: the description must also have changed.
    const switched = !onThisJob();
    if (switched) {
      const card = [...document.querySelectorAll(selectors.SELECTORS.jobCard)].find((c) => {
        const j = parse.parseJobCard(c, location.origin);
        return j && j.linkedin_job_id === jobId;
      });
      if (!card) return { ok: false, error: "Job card not in the page (scrolled out of the list?)" };
      card.scrollIntoView({ block: "center" });
      const link = card.querySelector(selectors.SELECTORS.link) || card;
      link.click();
    }
    const read = () => {
      const d = detail.extractDetail(document);
      const ok = detail.acceptDetail({
        d,
        before,
        switched,
        urlMatches: onThisJob(),
        paneMatch: detail.paneMatchesJob(document, jobId),
      });
      return ok ? d : null;
    };
    // Wait for the pane to switch to this job and expose its (new) description.
    const deadline = Date.now() + 10000;
    let d = null;
    while (Date.now() < deadline) {
      await sleep(300);
      if (blocked(capture)) return { ok: true, blocked: true };
      d = read();
      if (d) break;
    }
    if (!d) return { ok: false, error: "Description did not load for this job" };
    const more = document.querySelector(selectors.DETAIL_SELECTORS.seeMore);
    if (more) {
      more.click();
      await sleep(Math.min(delayMs || 400, 600));
      // Re-verify after expansion; never keep text from a pane that changed under us.
      d = read();
      if (!d) return { ok: false, error: "Pane changed while expanding description" };
    }
    return { ok: true, detail_payload: detail.buildDetailJob(jobId, d).detail_payload };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === "CHECK_SEARCH_READY") {
      load("searchCollect")
        .then((searchCollect) => {
          const onSearch = /linkedin\.com\/search\/results\/content/i.test(location.href);
          const urlKeywords = searchCollect.getUrlSearchKeywords(location.href);
          const match = msg.processedKeywords
            ? searchCollect.keywordsMatch(urlKeywords, msg.processedKeywords)
            : onSearch;
          const domReady = isSearchDomReady();
          const ready =
            onSearch &&
            match &&
            (document.readyState === "complete" || document.readyState === "interactive") &&
            (domReady || Number(msg.pollCount || 0) >= 2);
          sendResponse({ ok: true, ready, keywordsMatch: match, domReady, onSearch });
        })
        .catch((e) => sendResponse({ ok: false, error: err(e) }));
      return true;
    }
    if (msg.type === "CAPTURE_VISIBLE" || msg.type === "CAPTURE_PAGE") {
      loadAll()
        .then(({ parse, posts, searchCollect }) => {
          const onJobs = /\/jobs\//.test(location.pathname);
          const onSearch = /\/search\/results\/content/i.test(location.pathname);
          const items = parsePage(parse, posts, searchCollect);
          sendResponse({
            ok: true,
            jobs: items,
            kind: onJobs ? "jobs" : onSearch ? "content_search" : "posts",
            search_url: location.href,
          });
        })
        .catch((e) => sendResponse({ ok: false, error: err(e) }));
      return true; // async response
    }
    if (msg.type === "HUNT_START" || msg.type === "DEEP_START") {
      if (deepRunning) {
        sendResponse({ ok: false, error: "Already running" });
        return false;
      }
      deepRunning = true;
      stopRequested = false;
      const run =
        msg.type === "HUNT_START"
          ? runHunt({
              targetEmails: msg.targetEmails,
              delayMs: msg.delayMs,
              maxItems: msg.maxItems,
            })
          : runDeepCapture({ maxJobs: msg.maxJobs, delayMs: msg.delayMs });
      run.finally(() => {
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
