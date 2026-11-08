// Classic content script (MV3 content scripts cannot use static ESM imports),
// so the shared parser is loaded via dynamic import of a web-accessible module.
(() => {
  if (window.__outreachStudioJobsLoaded) return;
  window.__outreachStudioJobsLoaded = true;

  let parserPromise;
  const loadParser = () =>
    (parserPromise ||= import(chrome.runtime.getURL("src/lib/parse.js")));

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "CAPTURE_VISIBLE") return false;
    loadParser()
      .then(({ parseVisibleJobs }) => {
        const jobs = parseVisibleJobs(document, location.origin);
        sendResponse({ ok: true, jobs, search_url: location.href });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true; // async response
  });
})();
