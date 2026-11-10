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

    // ReachIn-style page sweep: visible @ not already in a parsed post still get uploaded —
    // but attach the hosting card (author / designation / full body) whenever possible.
    if (!onJobs && searchCollect?.extractEmailsFromDocument) {
      const pageEmails = searchCollect.extractEmailsFromDocument(document);
      const known = emailsAlreadyInItems(items);
      const missing = pageEmails.filter((e) => !known.has(e));
      if (missing.length) {
        const keywords = searchCollect.getUrlSearchKeywords?.(location.href) || "";
        const seenIds = new Set(items.map((it) => it.linkedin_job_id));
        const stillMissing = [];
        for (const email of missing) {
          const card = posts.findCardForEmail?.(document, email);
          const fromCard = card
            ? posts.cardToPost?.(card, location.origin, { email })
            : null;
          if (fromCard) {
            const desc = fromCard.detail_payload?.description || "";
            if (!desc.toLowerCase().includes(email.toLowerCase())) {
              // Keep body scoped to this post — append email only, never page mashup.
              fromCard.detail_payload.description = `${desc}\n${email}`.slice(0, 20000);
              fromCard.list_payload.preview = fromCard.detail_payload.description.slice(0, 280);
            }
            if (!seenIds.has(fromCard.linkedin_job_id)) {
              seenIds.add(fromCard.linkedin_job_id);
              items.push(fromCard);
            }
            known.add(email.toLowerCase());
            continue;
          }
          stillMissing.push(email);
        }
        if (stillMissing.length) {
          items = items.concat(
            searchCollect.emailsAsSyntheticPosts(stillMissing, {
              base: "",
              keywords,
              urlForEmail: (email) => {
                const card = posts.findCardForEmail?.(document, email);
                if (!card) return "";
                const resolve = posts.resolvePostPermalink || posts.postUrl;
                if (!resolve) return "";
                const url = resolve(card, location.origin);
                return url && !posts.isSearchOrListUrl?.(url) ? url : "";
              },
              metaForEmail: (email) => {
                // Last resort: still attach surrounding page text so View post isn't email-only.
                const card = posts.findCardForEmail?.(document, email);
                const resolve = posts.resolvePostPermalink || posts.postUrl;
                const job_url =
                  card && resolve ? resolve(card, location.origin) || "" : "";
                const windowText = posts.textWindowAroundEmail?.(document, email, 1000) || "";
                const lines = windowText
                  .split(/\n+/)
                  .map((l) => l.trim())
                  .filter(Boolean);
                const emailLine = lines.findIndex((l) => l.toLowerCase().includes(email.toLowerCase()));
                const before = emailLine > 0 ? lines.slice(Math.max(0, emailLine - 6), emailLine) : [];
                const authorGuess = before.find((l) => l.length > 2 && l.length < 80 && !/@/.test(l) && !/^http/i.test(l)) || "";
                const subtitleGuess =
                  [...before].reverse().find(
                    (l) =>
                      l !== authorGuess &&
                      l.length > 2 &&
                      l.length < 120 &&
                      !/@/.test(l) &&
                      /(at |@|manager|engineer|recruiter|founder|ceo|hr|talent)/i.test(l)
                  ) || "";
                return {
                  author: authorGuess,
                  subtitle: subtitleGuess,
                  description: windowText || email,
                  job_url: job_url && !posts.isSearchOrListUrl?.(job_url) ? job_url : "",
                };
              },
            })
          );
        }
      }
    }

    // Guarantee: every captured post carries its openable permalink when URN/link exists in DOM.
    for (const item of items) {
      if (item.job_url && !posts.isSearchOrListUrl?.(item.job_url)) continue;
      const urn = item.list_payload?.urn || item.detail_payload?.urn || "";
      const fromUrn = urn && posts.urlFromActivityUrn ? posts.urlFromActivityUrn(urn) : "";
      if (fromUrn) {
        item.job_url = fromUrn;
        if (item.detail_payload) item.detail_payload.post_url = fromUrn;
        if (item.list_payload && !item.list_payload.urn) item.list_payload.urn = urn;
      }
    }

    void onContentSearch;
    return items;
  }

  async function attachCopiedPostLinks(items, posts) {
    return posts.resolveCopiedPostLinks(items, async (card, email) => {
      const token = crypto.randomUUID();
      card.setAttribute('data-outreach-copy-token', token);
      try {
        const response = await chrome.runtime.sendMessage({ type: 'COPY_POST_LINK', token, email });
        return response?.ok ? response.url : '';
      } finally {
        if (card.getAttribute('data-outreach-copy-token') === token) card.removeAttribute('data-outreach-copy-token');
      }
    }, () => stopRequested);
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
          if (!onJobs) await attachCopiedPostLinks(items, posts);
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
        .then(async ({ parse, posts, searchCollect }) => {
          const onJobs = /\/jobs\//.test(location.pathname);
          const onSearch = /\/search\/results\/content/i.test(location.pathname);
          const items = parsePage(parse, posts, searchCollect);
          if (!onJobs) await attachCopiedPostLinks(items, posts);
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
