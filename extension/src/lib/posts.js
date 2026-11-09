// Parse visible LinkedIn feed / activity posts into the same shape the jobs uploader expects.
import { JOB_ID_FROM_URL } from "./selectors.js";

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

// Full post wrappers only — NEVER `.update-components-actor` (that's just the name row;
// emails live in sibling commentary, so actor-only matches produced email-less "posts"
// and forced the page-sweep into bare "LinkedIn search email" synthetics).
const POST_CARD =
  '.feed-shared-update-v2, .occludable-update, article.feed-shared-update-v2, article[data-urn], div[data-urn*="activity:"], div[data-urn*="ugcPost:"], div[data-urn*="share:"], [data-chameleon-result-urn], [data-id*="urn:li:activity"], [data-id*="urn:li:ugcPost"], .reusable-search__result-container, li.reusable-search__result-container, div.feed-shared-update-v2__control-menu-container, .update-components-mini-update-v2';

const POST_CONTAINER_HINT =
  /activity:|ugcPost:|share:|feed-shared-update|occludable-update|chameleon-result|reusable-search__result/i;

const POST_TEXT =
  ".feed-shared-update-v2__description, .feed-shared-text, .update-components-text, .break-words, .feed-shared-inline-show-more-text, .feed-shared-update-v2__commentary, .feed-shared-inline-show-more-text__text, span.break-words";

const POST_AUTHOR =
  ".update-components-actor__name, .feed-shared-actor__name, .update-components-actor__title span[aria-hidden='true'], .update-components-actor__title, .feed-shared-actor__title, .entity-result__title-text a span[aria-hidden='true'], .entity-result__title-text a, .artdeco-entity-lockup__title, .update-components-actor__container a[href*='/in/'] span[aria-hidden='true']";

// Never include supplementary-actor-info ("• 2nd") — that is degree, not designation.
const POST_SUBTITLE =
  ".update-components-actor__description, .feed-shared-actor__description, .update-components-actor__meta, .entity-result__primary-subtitle, .artdeco-entity-lockup__subtitle";

const POST_TIME =
  "time[datetime], .update-components-actor__sub-description time, .feed-shared-actor__sub-description time, a.update-components-actor__sub-description-link time";

const POST_LINK =
  'a[href*="/posts/"], a[href*="/feed/update/"], a[href*="activity-"], a[href*="urn:li:activity"], a[href*="urn:li:ugcPost"], a[href*="urn:li:share"], a.update-components-actor__sub-description-link';

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const AUTHOR_JUNK =
  /^(live demos|working hours|lahore location|google sheets|hiring alert|location|follow|connect|promoted|view|like|comment|repost|send|us|uk|uae|remote|full[- ]time|part[- ]time|data engineer|recruiter|hiring)$/i;
const AUTHOR_JUNK_SUFFIX = /(hours|location|sheets|alert)$/i;

/** LinkedIn bodies: "Feed post Name • 2nd Headline 2h" OR "Fatima Khan • 2nd Headline 8h". */
export function parseFeedPostHeader(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  // Find "• 2nd … 8h" then take trailing name tokens immediately before the bullet.
  const m = raw.match(
    /\s+•\s+(\d+(?:st|nd|rd|th)\+?)\s+(.+?)\s+(\d+\s*(?:mo|yr|y|[smhdw])|just now|yesterday)\b/i
  );
  if (!m) return null;
  const before = raw
    .slice(0, m.index)
    .replace(/^(?:Feed post\s+)/i, "")
    .trim();
  const author = cleanAuthor(trailingPersonName(before));
  let subtitle = clean(m[2])
    .replace(/\s+(Follow|Connect|Edited|•|·\s*Visible to anyone).*$/i, "")
    .trim();
  if (subtitle.length > 200) subtitle = subtitle.slice(0, 200);
  const posted_at_text = clean(m[3]);
  if (!author && !subtitle && !posted_at_text) return null;
  return { author, subtitle, posted_at_text, degree: m[1] };
}

/** Pull employer from headline: "CEO @ Acme" / "Manager at Acme". */
export function companyFromSubtitle(subtitle) {
  const raw = clean(subtitle || "");
  if (!raw) return "";
  const at = raw.match(/\bat\s+([^|•·@]{2,80})$/i) || raw.match(/@\s*([^|•·]{2,80})$/i);
  if (!at) return "";
  let company = clean(at[1]).replace(/\s+/g, " ").trim();
  company = company.replace(/\s+(Follow|Connect|Edited).*$/i, "").trim();
  if (company.length < 2 || company.length > 120) return "";
  if (/^(us|uk|uae|remote|linkedin)$/i.test(company)) return "";
  return company;
}

const COMPANY_FILLER =
  /\b(our|growing|team|looking|talented|join|joining|hiring|the|a|an|for|to|at|and|with)\b/i;

/** Brand-like employer token(s); rejects sentence fragments. */
function cleanCompanyCandidate(value) {
  let company = clean(value || "").replace(/[!.,;:]+$/g, "").trim();
  if (company.length < 2 || company.length > 80) return "";
  if (/^(us|uk|uae|remote|linkedin|me|our team)$/i.test(company)) return "";
  if (COMPANY_FILLER.test(company) && !/^[A-Z0-9][A-Z0-9&.'’-]*$/.test(company)) return "";
  // ALL-CAPS brands (BIZSCALE) always ok; otherwise reject filler phrases.
  if (COMPANY_FILLER.test(company) && company !== company.toUpperCase()) return "";
  return company;
}

/** Employer from post copy: "Hiring at TechPrysm!" / "team at BIZSCALE!" / "Join Acme Robotics". */
export function companyFromBody(text) {
  const raw = String(text || "");
  if (!raw) return "";
  // Keywords case-flexible; brand capture stays case-sensitive (must start with A–Z).
  const patterns = [
    /\b[Hh]iring(?:\s+[Nn]ow)?\s+[Aa]t\s+([A-Z][A-Za-z0-9&.'’-]{1,40}(?:\s+[A-Z][A-Za-z0-9&.'’-]{1,40}){0,3})\s*[!.]?/,
    /\b(?:[Jj]oin(?:ing)?|[Tt]eam|[Cc]ompany|[Rr]ole)(?:\s+[a-z0-9'’-]+){0,6}\s+[Aa]t\s+([A-Z][A-Za-z0-9&.'’-]{1,40}(?:\s+[A-Z][A-Za-z0-9&.'’-]{1,40}){0,3})\s*[!.]?/,
    /\b[Jj]oin(?:ing)?\s+([A-Z][A-Za-z0-9&.'’-]{1,40}(?:\s+[A-Z][A-Za-z0-9&.'’-]{1,40}){0,3})\b/,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    const company = cleanCompanyCandidate(m[1]);
    if (company) return company;
  }
  return "";
}

/** "/in/halima-ehsan-…" or "/posts/ayesha-sibtain-abbas-activity-…" → person name. */
export function authorFromProfileHref(href) {
  if (!href) return "";
  let path = "";
  try {
    path = new URL(href, "https://www.linkedin.com").pathname || "";
  } catch {
    path = String(href);
  }
  const m = path.match(/\/in\/([^/?#]+)/i) || path.match(/\/posts\/([^/?#]+)/i);
  if (!m) return "";
  const parts = decodeURIComponent(m[1])
    .split("-")
    .map((p) => p.trim())
    .filter(Boolean);
  const nameParts = [];
  for (const part of parts) {
    if (/^(activity|ugcpost|share)$/i.test(part)) break;
    if (/^\d+$/.test(part) || /^[a-f0-9]{6,}$/i.test(part)) break;
    if (!/^[A-Za-z][A-Za-z.'’]*$/.test(part)) break;
    nameParts.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
    if (nameParts.length >= 4) break;
  }
  return cleanAuthor(nameParts.join(" "));
}

/**
 * Drop actor chrome mashed into body: "Name • 2nd Headline 7h Connect … more 56 11 4".
 * Keeps the real post copy (e.g. starts at "Hiring at TechPrysm!").
 */
export function stripPostChrome(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const header = parseFeedPostHeader(t);
  if (header) {
    const stripped = t.replace(
      /^(?:Feed post\s+)?[\s\S]*?•\s+\d+(?:st|nd|rd|th)\+?\s+.+?\s+(?:\d+\s*(?:mo|yr|y|[smhdw])|just now|yesterday)\b(?:\s*(?:Connect|Follow|Edited))*\s*/i,
      ""
    );
    if (stripped && stripped.length >= 12) t = stripped.trim();
  }
  t = t.replace(/\s*(?:…|\.{3})\s*more\b[\s\S]*$/i, "").trim();
  t = t.replace(/\s+\d{1,4}(?:\s+\d{1,4}){1,3}\s*$/g, "").trim();
  return t;
}

export function cleanAuthor(name) {
  let n = clean(name || "");
  if (!n) return "";
  const viewed = n.match(/^View\s+(.+?)(?:['’]s)?\s+profile$/i);
  if (viewed) n = clean(viewed[1]);
  if (AUTHOR_JUNK.test(n) || AUTHOR_JUNK_SUFFIX.test(n)) return "";
  if (n.length < 2 || n.length > 80) return "";
  if (/@/.test(n) || /^https?:/i.test(n)) return "";
  return n;
}

const NAME_STOP =
  /^(before|after|the|and|with|from|for|noise|hiring|follow|connect|at|ceo|founder|manager)$/i;

/** Last 1–3 person-name tokens from text before "• 2nd". */
export function trailingPersonName(before) {
  const parts = clean(before || "").split(/\s+/).filter(Boolean);
  const nameParts = [];
  for (let i = parts.length - 1; i >= 0 && nameParts.length < 3; i--) {
    const tok = parts[i].replace(/[^\w.'’-]/g, "");
    if (!tok || NAME_STOP.test(tok) || !/^[A-Za-z]/.test(tok)) break;
    nameParts.unshift(tok);
  }
  return nameParts.join(" ");
}

/** Prefer fuller poster name ("Fatima Khan" over "Khan"). Only expand last-name-only. */
export function preferAuthor(current, next) {
  const a = cleanAuthor(current);
  const b = cleanAuthor(next);
  if (!b) return a;
  if (!a) return b;
  const aL = a.toLowerCase();
  const bL = b.toLowerCase();
  if (aL === bL) return a;
  const aParts = a.split(/\s+/);
  const bParts = b.split(/\s+/);
  // Expand single-token last name → full name.
  if (aParts.length === 1 && bParts.length > 1 && bL.endsWith(` ${aL}`)) return b;
  if (bParts.length === 1 && aParts.length > 1 && aL.endsWith(` ${bL}`)) return a;
  return a;
}

function stableId(parts) {
  const raw = parts.filter(Boolean).join("|").slice(0, 400);
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `p${(h >>> 0).toString(36)}`;
}

function cardUrn(card) {
  const attrs = [
    card.getAttribute("data-urn"),
    card.getAttribute("data-chameleon-result-urn"),
    card.getAttribute("data-id"),
  ].filter(Boolean);
  for (const value of attrs) {
    if (/activity|ugcPost|share/i.test(value)) return value;
  }
  const nested = card.querySelector(
    "[data-urn*='activity:'], [data-urn*='ugcPost:'], [data-urn*='share:'], [data-chameleon-result-urn*='activity:'], [data-chameleon-result-urn*='ugcPost:'], [data-id*='activity:']"
  );
  return (
    nested?.getAttribute("data-urn") ||
    nested?.getAttribute("data-chameleon-result-urn") ||
    nested?.getAttribute("data-id") ||
    attrs[0] ||
    ""
  );
}

function urnId(card) {
  const urn = cardUrn(card);
  const m = /(?:activity|ugcPost|share):(\d{6,})/.exec(urn);
  if (m) return `p${m[1]}`.slice(0, 64);
  if (urn) return stableId([urn]).slice(0, 64);
  return "";
}

/** Build a permalink that opens the exact post (not the search page). */
export function urlFromActivityUrn(urn) {
  if (!urn) return "";
  const full = /urn:li:(activity|ugcPost|share):(\d{6,})/.exec(urn);
  if (full) return `https://www.linkedin.com/feed/update/urn:li:${full[1]}:${full[2]}/`;
  const short = /(activity|ugcPost|share):(\d{6,})/.exec(urn);
  if (short) return `https://www.linkedin.com/feed/update/urn:li:${short[1]}:${short[2]}/`;
  return "";
}

export function isSearchOrListUrl(url) {
  if (!url) return true;
  return /\/search\/results\//i.test(url) || /\/jobs\/search/i.test(url) || /\/jobs\/collections/i.test(url);
}

export function isPostPermalink(url) {
  if (!url || isSearchOrListUrl(url)) return false;
  return /\/feed\/update\/urn:li:(activity|ugcPost|share):\d+/i.test(url) || /\/posts\/[^/?#]+/i.test(url);
}

function activityIdFromHref(href) {
  if (!href) return "";
  const fromPosts = /activity-(\d{6,})/i.exec(href);
  if (fromPosts) return fromPosts[1];
  const fromUrn = /urn:li:(?:activity|ugcPost|share):(\d{6,})/i.exec(href);
  if (fromUrn) return fromUrn[1];
  return "";
}

function cleanPostUrl(href, base) {
  try {
    const u = new URL(href, base || "https://www.linkedin.com");
    if (!/linkedin\.com$/i.test(u.hostname) && !/\.linkedin\.com$/i.test(u.hostname)) return "";
    if (isSearchOrListUrl(u.href) || /\/jobs\/view\//i.test(u.pathname)) return "";
    let path = u.pathname || "/";
    if (!path.endsWith("/")) path += "/";
    return `${u.origin}${path}`;
  } catch {
    return "";
  }
}

function collectPostHrefs(card) {
  const hrefs = [];
  const seen = new Set();
  if (!card?.querySelectorAll) return hrefs;
  // Prefer known post-link selectors, then any anchor that looks like a permalink.
  const nodes = [
    ...card.querySelectorAll(POST_LINK),
    ...card.querySelectorAll("a[href]"),
  ];
  for (const a of nodes) {
    const href = (a.getAttribute("href") || "").trim();
    if (!href || href.startsWith("#") || seen.has(href)) continue;
    if (
      !/\/posts\/|\/feed\/update\/|activity-|urn:li:(?:activity|ugcPost|share)/i.test(href)
    ) {
      continue;
    }
    seen.add(href);
    hrefs.push(href);
  }
  return hrefs;
}

/** True when this node (or descendants) exposes a real post URN or permalink anchor. */
export function hasPostPermalinkSignal(el) {
  if (!el || el.nodeType !== 1) return false;
  if (cardUrn(el)) return true;
  return collectPostHrefs(el).length > 0;
}

/**
 * Permalink for one DOM node only (no ancestor walk).
 * Prefer `/posts/...` over reconstructed `/feed/update/urn:...`.
 */
export function postUrlFromNode(card, base = "https://www.linkedin.com") {
  if (!card) return "";
  const hrefs = collectPostHrefs(card);

  for (const href of hrefs) {
    const cleaned = cleanPostUrl(href, base);
    if (cleaned && /\/posts\//i.test(cleaned) && isPostPermalink(cleaned)) return cleaned;
  }

  for (const href of hrefs) {
    const cleaned = cleanPostUrl(href, base);
    if (cleaned && /\/feed\/update\//i.test(cleaned) && isPostPermalink(cleaned)) return cleaned;
  }

  const fromUrn = urlFromActivityUrn(cardUrn(card));
  if (fromUrn) return fromUrn;

  for (const href of hrefs) {
    const activityId = activityIdFromHref(href);
    if (!activityId) continue;
    const kind = /ugcPost/i.test(href) ? "ugcPost" : /share[:\-]/i.test(href) ? "share" : "activity";
    return `https://www.linkedin.com/feed/update/urn:li:${kind}:${activityId}/`;
  }

  return "";
}

/**
 * Walk card → ancestors until we find a real post permalink.
 * Email text often sits in a commentary div; the URN / `/posts/` link lives on the parent card.
 */
export function resolvePostPermalink(card, base = "https://www.linkedin.com") {
  let node = card;
  for (let i = 0; node && i < 10; i++) {
    const url = postUrlFromNode(node, base);
    if (url) return url;
    node = node.parentElement;
  }
  return "";
}

/** @deprecated use resolvePostPermalink — kept as alias for callers/tests */
export function postUrl(card, base = "https://www.linkedin.com") {
  return resolvePostPermalink(card, base);
}

function firstMatchText(card, selector) {
  for (const el of card.querySelectorAll(selector)) {
    const t = clean(el.textContent);
    if (t && t.length > 2) return t;
  }
  return "";
}

function postTime(card) {
  const el = card.querySelector(POST_TIME);
  if (!el) {
    // Do not use firstMatchText here — it skips 2-char labels like "1d" / "2h".
    const sel =
      ".update-components-actor__sub-description, .feed-shared-actor__sub-description, .update-components-actor__meta";
    for (const node of card.querySelectorAll(sel)) {
      const text = clean(node.textContent);
      if (!text) continue;
      // Put `mo` / `yr` before `m` / `y` so "3mo" is not captured as "3m".
      if (
        /^(\d+\s*(?:mo|yr|y)|just now|yesterday|\d+\s*[smhdw])\b/i.test(text) ||
        /\bedited\b/i.test(text)
      ) {
        const token =
          text.match(/^(\d+\s*(?:mo|yr|y)|just now|yesterday|\d+\s*[smhdw])/i)?.[0] || text;
        return { posted_at: "", posted_at_text: clean(token) };
      }
    }
    return { posted_at: "", posted_at_text: "" };
  }
  const posted_at = (el.getAttribute("datetime") || "").trim();
  const posted_at_text = clean(el.textContent) || posted_at;
  return { posted_at, posted_at_text };
}

const SEE_MORE_SEL =
  "button.see-more:not([data-clicked='true']), button.feed-shared-inline-show-more-text__button:not([data-clicked='true']), button[aria-label*='see more' i]:not([data-clicked='true']), button[aria-label*='Show more' i]:not([data-clicked='true']), .feed-shared-inline-show-more-text button:not([data-clicked='true'])";

/** ReachIn-style: click truncated "see more" once and mark so we don't re-click. */
export function expandAllSeeMore(root = document) {
  let clicked = 0;
  for (const btn of root.querySelectorAll(SEE_MORE_SEL)) {
    const label = `${btn.getAttribute("aria-label") || ""} ${btn.textContent || ""}`.toLowerCase();
    if (!(label.includes("see more") || label.includes("show more") || label.includes("…") || /\bmore\b/.test(label))) {
      continue;
    }
    try {
      btn.click();
      btn.setAttribute("data-clicked", "true");
      clicked += 1;
    } catch {
      /* ignore */
    }
  }
  return clicked;
}

function expandSeeMore(card) {
  expandAllSeeMore(card);
}

/**
 * When LinkedIn / our container mashed several posts into one string, keep only the
 * segment that owns this email (split on "Feed post …" headers).
 */
export function isolatePostSegment(text, email = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const needle = String(email || "").toLowerCase().trim();
  const parts = raw.split(/(?=Feed post\s+)/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    if (needle) {
      const hit = parts.find((p) => p.toLowerCase().includes(needle));
      if (hit) return hit;
    }
    return parts[0];
  }
  // Also split when another actor header appears mid-blob without "Feed post" prefix.
  const actorParts = raw.split(/(?=\b[A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+){0,3}\s+•\s+(?:\d+(?:st|nd|rd|th)\+?)\b)/);
  if (needle && actorParts.length > 1) {
    const hit = actorParts.map((p) => p.trim()).filter(Boolean).find((p) => p.toLowerCase().includes(needle));
    if (hit && hit.length > 40) return hit;
  }
  return raw;
}

/**
 * Raw body segment for ONE post (may still include actor chrome).
 * Prefer the smallest POST_TEXT node that contains the email when provided.
 */
export function rawPostSegment(card, { email = "" } = {}) {
  if (!card) return "";
  expandSeeMore(card);
  const needle = String(email || "").toLowerCase().trim();
  const chunks = [];
  for (const el of card.querySelectorAll(POST_TEXT)) {
    // Skip wrapper nodes that only wrap another POST_TEXT child (prefer leaf commentary).
    if (el.querySelector?.(POST_TEXT)) continue;
    const t = clean(el.textContent);
    if (!t || t.length < 8) continue;
    if (chunks.some((c) => c.t === t)) continue;
    chunks.push({ el, t });
  }

  let chosen = "";
  if (needle) {
    const hits = chunks.filter((c) => c.t.toLowerCase().includes(needle));
    if (hits.length) {
      hits.sort((a, b) => a.t.length - b.t.length);
      chosen = hits[0].t;
    }
  }
  if (!chosen && chunks.length) {
    chunks.sort((a, b) => b.t.length - a.t.length);
    chosen = chunks[0].t;
  }
  if (!chosen) {
    const fallback = card.querySelector(
      ".feed-shared-update-v2__description, .feed-shared-update-v2__commentary, .update-components-text, .feed-shared-text"
    );
    chosen = clean(fallback?.textContent || "");
  }
  if (!chosen) {
    // Loose LinkedIn DOM sometimes puts the email in a bare text node with no commentary class.
    chosen = clean(card.innerText || "");
  }
  // If we still missed the email (commentary class lacked it), take the isolated segment from card text.
  if (needle && chosen && !chosen.toLowerCase().includes(needle)) {
    const fromCard = isolatePostSegment(clean(card.innerText || ""), email);
    if (fromCard.toLowerCase().includes(needle)) chosen = fromCard;
  }
  return isolatePostSegment(chosen, email).slice(0, 20000);
}

/** Clean post copy only — actor name/headline/time/Connect/engagement stripped. */
export function postBody(card, { email = "" } = {}) {
  return stripPostChrome(rawPostSegment(card, { email })).slice(0, 20000);
}

/** True when another matched card wraps this one — skip the inner commentary-only node. */
function isNestedCard(card, allCards) {
  return allCards.some((other) => other !== card && other.contains(card));
}

/** Best poster name from DOM + profile link (handles truncated "Ehsan" vs "Halima Ehsan"). */
function bestAuthorFromCard(card) {
  const candidates = [];
  for (const el of card.querySelectorAll(POST_AUTHOR)) {
    candidates.push(cleanAuthor(el.textContent));
  }
  for (const a of card.querySelectorAll('a[href*="/in/"]')) {
    candidates.push(cleanAuthor(a.getAttribute("aria-label") || ""));
    candidates.push(authorFromProfileHref(a.getAttribute("href") || ""));
    const hidden = a.querySelector(".visually-hidden, .a11y-text");
    if (hidden) candidates.push(cleanAuthor(hidden.textContent));
    for (const span of a.querySelectorAll('span[dir="ltr"], span[aria-hidden="true"]')) {
      candidates.push(cleanAuthor(span.textContent));
    }
  }
  const valid = candidates.filter(Boolean);
  valid.sort((a, b) => {
    const ap = a.split(/\s+/).length;
    const bp = b.split(/\s+/).length;
    if (bp !== ap) return bp - ap;
    return b.length - a.length;
  });
  return valid[0] || "";
}

/** Turn one LinkedIn post card into the upload shape (author, designation, time, full body). */
export function cardToPost(card, base = "https://www.linkedin.com", { pageHref = "", email = "" } = {}) {
  if (!card) return null;
  expandSeeMore(card);
  // Raw segment still carries "Name • 2nd … Nh" for header metadata; stored body is chrome-free.
  const rawSegment = rawPostSegment(card, { email });
  const body = stripPostChrome(rawSegment).slice(0, 20000);
  if (!body || body.length < 12) return null;
  let author = bestAuthorFromCard(card);
  let subtitle = firstMatchText(card, POST_SUBTITLE);
  if (subtitle && /^[•·]\s*\d+(?:st|nd|rd|th)/i.test(subtitle)) subtitle = "";
  if (!subtitle) {
    const lockup = clean(
      card.querySelector(".artdeco-entity-lockup__subtitle, .entity-result__primary-subtitle")
        ?.textContent || ""
    );
    if (lockup && lockup.length < 200 && !/^[•·]\s*\d+(?:st|nd|rd|th)/i.test(lockup)) {
      subtitle = lockup;
    }
  }
  const urn = cardUrn(card);
  // Always climb ancestors — commentary nodes often lack the post permalink.
  const url = resolvePostPermalink(card, base) || urlFromActivityUrn(urn);
  if (!author) author = authorFromProfileHref(url);
  let { posted_at, posted_at_text } = postTime(card);

  // Header metadata from raw mash (before chrome strip); body itself stays clean.
  const header = parseFeedPostHeader(rawSegment) || parseFeedPostHeader(body);
  if (header) {
    author = preferAuthor(author, header.author);
    if (header.subtitle && (!subtitle || subtitle.length < 8)) subtitle = header.subtitle;
    if (header.posted_at_text && !posted_at_text) posted_at_text = header.posted_at_text;
  }

  const companyName =
    companyFromSubtitle(subtitle) || companyFromBody(body) || companyFromBody(rawSegment);
  let id = urnId(card);
  if (!id) {
    const fromUrl = /(?:activity|ugcPost|share):(\d{6,})/i.exec(url || "") || JOB_ID_FROM_URL.exec(url || "");
    id = fromUrl ? `p${fromUrl[1]}` : stableId([url || "", author, body.slice(0, 160)]);
  }
  id = String(id).slice(0, 64);
  const href =
    pageHref ||
    (card.ownerDocument?.defaultView?.location?.href ||
      (typeof location !== "undefined" ? location.href : "") ||
      base);
  const onSearch = /\/search\/results\/content/i.test(href);
  return {
    linkedin_job_id: id,
    title: author || "LinkedIn post",
    // Company = employer only (from "at X" / "@ X"). Headline stays in subtitle → designation.
    company: companyName || "",
    location: "",
    job_url: url || "",
    list_payload: {
      kind: "post",
      author,
      subtitle,
      posted_at,
      posted_at_text,
      preview: body.slice(0, 280),
      source: onSearch ? "content_search" : "feed_post",
      urn: urn || "",
    },
    detail_payload: {
      description: body,
      kind: "post",
      author,
      subtitle,
      posted_at,
      posted_at_text,
      post_url: url || "",
    },
    detail_status: "fetched",
  };
}

function isPostContainer(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.matches?.(POST_CARD)) return true;
  const urn =
    el.getAttribute?.("data-urn") ||
    el.getAttribute?.("data-chameleon-result-urn") ||
    el.getAttribute?.("data-id") ||
    "";
  if (/(?:activity|ugcPost|share):/i.test(urn)) return true;
  const cls = `${el.className || ""}`;
  return POST_CONTAINER_HINT.test(cls);
}

/**
 * Climb from a node to the nearest full post container.
 * Prefer containers that already expose a post URN or permalink — email text often
 * lives in a commentary block that has no link of its own.
 */
export function closestPostContainer(node) {
  let cur = node?.nodeType === 3 ? node.parentElement : node;
  let withPermalink = null;
  let containerFallback = null;
  let softFallback = null;
  for (let i = 0; cur && i < 25; i++) {
    const hasLink = hasPostPermalinkSignal(cur);
    if (isPostContainer(cur)) {
      if (hasLink) return cur;
      if (!containerFallback) containerFallback = cur;
    }
    if (hasLink && !withPermalink) withPermalink = cur;
    const textLen = (cur.innerText || "").length;
    if (
      !softFallback &&
      textLen > 80 &&
      textLen < 20000 &&
      cur.querySelector?.('a[href*="/in/"], a[href*="/company/"]')
    ) {
      softFallback = cur;
    }
    cur = cur.parentElement;
  }
  return withPermalink || containerFallback || softFallback;
}

function hasActorSignal(el) {
  if (!el?.querySelector) return false;
  if (el.querySelector(POST_AUTHOR)) return true;
  if (el.querySelector(".update-components-actor__description, .feed-shared-actor__description")) {
    return true;
  }
  return !!el.querySelector('a[href*="/in/"]');
}

function betterEmailCard(candidate, current) {
  if (!current) return true;
  const candActor = hasActorSignal(candidate);
  const curActor = hasActorSignal(current);
  // Prefer the full post (actor + designation + time) over a nested commentary-only node.
  if (candActor !== curActor) return candActor;
  const candLink = hasPostPermalinkSignal(candidate);
  const curLink = hasPostPermalinkSignal(current);
  if (candLink !== curLink) return candLink;
  // Among equals, prefer the larger card (outer wrapper) so actor row is included.
  if (candActor && curActor) {
    return (candidate.innerText || "").length > (current.innerText || "").length;
  }
  return (candidate.innerText || "").length < (current.innerText || "").length;
}

/**
 * Find the post card that owns this email.
 * 1) Known post wrappers whose text includes the email (prefer ones with permalink)
 * 2) TreeWalker: email text node → climb to post container (handles LinkedIn DOM drift)
 */
export function findCardForEmail(root, email) {
  const needle = String(email || "").toLowerCase().trim();
  if (!needle || !root?.querySelectorAll) return null;

  const cards = [...root.querySelectorAll(POST_CARD)];
  let best = null;
  for (const card of cards) {
    const text = `${card.innerText || ""}`.toLowerCase();
    if (!text.includes(needle)) continue;
    if (isNestedCard(card, cards)) continue;
    if (betterEmailCard(card, best)) best = card;
  }
  if (best) return best;

  const doc = root.ownerDocument || root;
  const scope = root.body || root;
  if (!doc.createTreeWalker || !scope) return null;
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let node;
  let walkBest = null;
  while ((node = walker.nextNode())) {
    if (!(node.nodeValue || "").toLowerCase().includes(needle)) continue;
    const container = closestPostContainer(node);
    if (!container) continue;
    if (betterEmailCard(container, walkBest)) walkBest = container;
  }
  return walkBest;
}

/** Visible page text around an email — last-resort body when no card is found. */
export function textWindowAroundEmail(root, email, radius = 900) {
  const needle = String(email || "").toLowerCase().trim();
  const text = clean((root.body || root).innerText || "");
  if (!needle || !text) return "";
  const idx = text.toLowerCase().indexOf(needle);
  if (idx < 0) return "";
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return isolatePostSegment(text.slice(start, end).trim(), email);
}

export function parseVisiblePosts(root, base = "https://www.linkedin.com") {
  expandAllSeeMore(root);
  const seen = new Set();
  const posts = [];
  const cards = [...root.querySelectorAll(POST_CARD)];
  const pageHref =
    (root.ownerDocument || root)?.defaultView?.location?.href ||
    (typeof location !== "undefined" ? location.href : "") ||
    base;
  for (const card of cards) {
    // Prefer innermost cards so a search wrapper does not swallow many posts.
    if (isNestedCard(card, cards)) continue;
    const post = cardToPost(card, base, { pageHref });
    if (!post || seen.has(post.linkedin_job_id)) continue;
    seen.add(post.linkedin_job_id);
    posts.push(post);
  }
  return posts;
}
