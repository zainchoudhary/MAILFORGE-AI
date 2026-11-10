/** Runs in LinkedIn's MAIN world via scripting.executeScript; keep self-contained. */
export async function copyPostLinkInPage(token, email) {
  if (!/^[a-zA-Z0-9-]+$/.test(token || '')) return '';
  const card = document.querySelector(`[data-outreach-copy-token="${token}"]`);
  const ownsEmail = () => card?.isConnected && (card.textContent || '').toLowerCase().includes(email.toLowerCase());
  if (!email || !ownsEmail()) return '';
  const identity = () => ['data-urn', 'data-id', 'data-chameleon-result-urn'].map((a) => card.getAttribute(a) || '').join('|');
  const initialIdentity = identity();
  const trigger = card.querySelector('.feed-shared-control-menu__trigger, .feed-shared-update-v2__control-menu-container button, button[aria-label*="control menu"], button[aria-label*="More actions"]');
  if (!trigger || trigger.getAttribute('aria-expanded') === 'true') return '';
  const visible = (el) => !el.closest('[hidden], [aria-hidden="true"]') &&
    (typeof getComputedStyle !== 'function' || (getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'));
  const actions = () => [...document.querySelectorAll('[role="menuitem"], .artdeco-dropdown__item, button, a')]
    .filter((el) => visible(el) && /^copy link to post$/i.test((el.textContent || '').trim()));
  const before = new Set(actions());
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let captured = '';
  let restore = () => {};
  let restoreLegacy = () => {};
  let listening = false;
  const accept = (value) => {
    try {
      const url = new URL(String(value).trim());
      if (url.protocol !== 'https:') return false;
      const valid = (url.hostname === 'lnkd.in' && /^\/p\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) ||
        (/(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/(posts\/[^/]+|feed\/update\/urn:li:(activity|ugcPost|share):\d+)\/?$/.test(decodeURIComponent(url.pathname)));
      if (!valid) return false;
      captured = `${url.origin}${decodeURIComponent(url.pathname)}`;
      return true;
    } catch { return false; }
  };
  const onCopy = (event) => {
    // LinkedIn's legacy copy handler populates clipboardData during this event.
    queueMicrotask(() => accept(event.clipboardData?.getData('text/plain') || ''));
  };
  try {
    trigger.click();
    let action;
    const deadline = Date.now() + 1500;
    do {
      const controlled = document.getElementById(trigger.getAttribute('aria-controls') || '');
      action = actions().find((el) => card.contains(el) || controlled?.contains(el) || !before.has(el));
      if (action) break;
      await sleep(50);
    } while (Date.now() < deadline && ownsEmail());
    if (!action || !ownsEmail() || identity() !== initialIdentity) return '';

    // Capture only the URL produced by this click, without reading the system clipboard.
    const clipboard = navigator.clipboard;
    if (clipboard?.writeText) {
      const descriptor = Object.getOwnPropertyDescriptor(clipboard, 'writeText');
      const original = clipboard.writeText;
      Object.defineProperty(clipboard, 'writeText', { configurable: true, value(value) {
        if (accept(value)) return Promise.resolve();
        return original.call(clipboard, value);
      } });
      restore = () => {
        if (descriptor) Object.defineProperty(clipboard, 'writeText', descriptor);
        else delete clipboard.writeText;
      };
    }
    document.addEventListener('copy', onCopy, true);
    listening = true;
    if (typeof document.execCommand === 'function') {
      const descriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
      const original = document.execCommand;
      Object.defineProperty(document, 'execCommand', { configurable: true, value(command, ...args) {
        if (String(command).toLowerCase() === 'copy') {
          const active = document.activeElement;
          const selected = /^(TEXTAREA|INPUT)$/.test(active?.tagName || '')
            ? (active.value || '').slice(active.selectionStart || 0, active.selectionEnd ?? active.value.length)
            : document.getSelection()?.toString() || '';
          if (accept(selected)) return true;
        }
        return original.call(document, command, ...args);
      } });
      restoreLegacy = () => {
        if (descriptor) Object.defineProperty(document, 'execCommand', descriptor);
        else delete document.execCommand;
      };
    }
    action.click();
    const copyDeadline = Date.now() + 1200;
    while (!captured && Date.now() < copyDeadline && ownsEmail()) await sleep(50);
    return ownsEmail() && identity() === initialIdentity ? captured : '';
  } catch {
    return '';
  } finally {
    restoreLegacy();
    restore();
    if (listening) document.removeEventListener('copy', onCopy, true);
    if (trigger.getAttribute('aria-expanded') === 'true') trigger.click();
  }
}
