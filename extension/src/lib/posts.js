// Parse visible LinkedIn feed / activity posts into the same shape the jobs uploader expects.
import { JOB_ID_FROM_URL } from "./selectors.js";

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

// Broad enough for feed + content search; nested duplicates are filtered later.
const POST_CARD =
  '.feed-shared-update-v2, .occludable-update, article.feed-shared-update-v2, div[data-urn*="activity:"], div[data-urn*="ugcPost:"], div[data-urn*="share:"], [data-chameleon-result-urn], .reusable-search__result-container, .update-components-actor';

const POST_TEXT =
  ".feed-shared-update-v2__description, .feed-shared-text, .update-components-text, .break-words, .feed-shared-inline-show-more-text, .feed-shared-update-v2__commentary, .feed-shared-inline-show-more-text__text, span.break-words";

const POST_AUTHOR =
  ".update-components-actor__name, .feed-shared-actor__name, .update-components-actor__title span[aria-hidden='true'], .feed-shared-actor__title, .entity-result__title-text a span[aria-hidden='true']";

const POST_SUBTITLE =
  ".update-components-actor__description, .feed-shared-actor__description, .update-components-actor__meta, .entity-result__primary-subtitle";

const POST_LINK =
  'a[href*="/posts/"], a[href*="/feed/update/"], a[href*="activity-"], a[href*="urn:li:activity"], a[href*="urn:li:ugcPost"]';

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

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

export function postUrl(card, base = "https://www.linkedin.com") {
  const fromUrn = urlFromActivityUrn(cardUrn(card));
  if (fromUrn) return fromUrn;

  for (const a of card.querySelectorAll(POST_LINK)) {
    const href = a.getAttribute("href") || "";
    if (!href || href.startsWith("#")) continue;
    const activityId = activityIdFromHref(href);
    if (activityId) {
      const kind = /ugcPost/i.test(href) ? "ugcPost" : "activity";
      return `https://www.linkedin.com/feed/update/urn:li:${kind}:${activityId}/`;
    }
    const cleaned = cleanPostUrl(href, base);
    if (isPostPermalink(cleaned)) return cleaned;
  }

  return "";
}

function firstMatchText(card, selector) {
  for (const el of card.querySelectorAll(selector)) {
    const t = clean(el.textContent);
    if (t && t.length > 2) return t;
  }
  return "";
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

function postBody(card) {
  expandSeeMore(card);
  const chunks = [];
  for (const el of card.querySelectorAll(POST_TEXT)) {
    const t = clean(el.textContent);
    if (t && t.length > 8 && !chunks.includes(t)) chunks.push(t);
  }
  chunks.sort((a, b) => b.length - a.length);
  const best = chunks[0] || "";
  const joined = chunks.slice(0, 6).join("\n");
  const full = clean(card.innerText || "").slice(0, 8000);
  // Prefer structured post text, but keep full card text so emails outside description nodes are kept.
  const primary = joined.length > best.length ? joined : best;
  if (!primary) return full;
  if (full && full.length > primary.length && EMAIL_RE.test(full) && !EMAIL_RE.test(primary)) {
    return `${primary}\n${full}`;
  }
  return primary || full;
}

function isNestedCard(card, allCards) {
  return allCards.some((other) => other !== card && card.contains(other));
}

export function parseVisiblePosts(root, base = "https://www.linkedin.com") {
  expandAllSeeMore(root);
  const seen = new Set();
  const posts = [];
  const cards = [...root.querySelectorAll(POST_CARD)];
  for (const card of cards) {
    // Prefer innermost cards so a search wrapper does not swallow many posts.
    if (isNestedCard(card, cards)) continue;
    const body = postBody(card);
    if (!body || body.length < 12) continue;
    const author = firstMatchText(card, POST_AUTHOR);
    const subtitle = firstMatchText(card, POST_SUBTITLE);
    const urn = cardUrn(card);
    // Permalink when available; empty is OK — emails still upload + extract.
    const url = postUrl(card, base);

    let id = urnId(card);
    if (!id) {
      const fromUrl = /(?:activity|ugcPost|share):(\d{6,})/i.exec(url || "") || JOB_ID_FROM_URL.exec(url || "");
      id = fromUrl ? `p${fromUrl[1]}` : stableId([url || "", author, body.slice(0, 160)]);
    }
    id = String(id).slice(0, 64);
    if (seen.has(id)) continue;
    seen.add(id);
    const pageHref =
      (root.ownerDocument || root)?.defaultView?.location?.href ||
      (typeof location !== "undefined" ? location.href : "") ||
      base;
    const onSearch = /\/search\/results\/content/i.test(pageHref);
    posts.push({
      linkedin_job_id: id,
      title: author || "LinkedIn post",
      company: subtitle || "",
      location: "",
      job_url: url || "",
      list_payload: {
        kind: "post",
        author,
        subtitle,
        preview: body.slice(0, 280),
        source: onSearch ? "content_search" : "feed_post",
        urn: urn || "",
      },
      detail_payload: { description: body, kind: "post", author, subtitle, post_url: url || "" },
      detail_status: "fetched",
    });
  }
  return posts;
}
