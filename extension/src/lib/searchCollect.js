// ReachIn-inspired LinkedIn content-search helpers (keywords → search URL → page ready).

export function processKeywords(input) {
  const keywords = String(input || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (!keywords.length) return "";
  return keywords.map((k) => `"${k}"`).join(" AND ");
}

export function normalizeKeywordsForComparison(keywords) {
  if (!keywords) return [];
  return String(keywords)
    .replace(/"/g, "")
    .replace(/\s+AND\s+/gi, ",")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

export function keywordsMatch(urlKeywords, processedKeywords) {
  const fromUrl = normalizeKeywordsForComparison(urlKeywords);
  const expected = normalizeKeywordsForComparison(processedKeywords);
  if (!fromUrl.length || !expected.length) return false;
  if (fromUrl.length !== expected.length) return false;
  return fromUrl.every((k, i) => k === expected[i]);
}

export function getUrlSearchKeywords(url) {
  try {
    const keywords = new URL(url).searchParams.get("keywords");
    if (!keywords) return "";
    return decodeURIComponent(keywords.replace(/\+/g, " "));
  } catch {
    return "";
  }
}

/** LinkedIn Posts/content search — emails show up in public post text. */
export function buildContentSearchUrl(processedKeywords) {
  return (
    "https://www.linkedin.com/search/results/content/?keywords=" +
    encodeURIComponent(processedKeywords) +
    "&origin=GLOBAL_SEARCH_HEADER&sortBy=date_posted"
  );
}

export function isLinkedInUrl(url) {
  return Boolean(url && /https?:\/\/([a-z0-9-]+\.)?linkedin\.com\//i.test(url));
}

export function isContentSearchUrl(url) {
  return Boolean(url && /linkedin\.com\/search\/results\/content/i.test(url));
}

export function detectCollectionContext(url, processedKeywords) {
  if (!isLinkedInUrl(url)) return "offLinkedIn";
  if (!isContentSearchUrl(url)) return "linkedInOther";
  const current = getUrlSearchKeywords(url);
  if (!keywordsMatch(current, processedKeywords)) return "searchMismatch";
  return "searchReady";
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

/** Pull unique lowercase emails from mailto: links + visible page text. */
export function extractEmailsFromDocument(doc) {
  const found = new Set();
  if (!doc?.querySelectorAll) return [];

  for (const link of doc.querySelectorAll('a[href^="mailto:"]')) {
    const email = (link.getAttribute("href") || "")
      .replace(/^mailto:/i, "")
      .split("?")[0]
      .trim()
      .toLowerCase();
    if (isValidEmail(email)) found.add(email);
  }

  const text = doc.body?.innerText || "";
  for (const match of text.match(EMAIL_RE) || []) {
    const email = match.toLowerCase();
    if (isValidEmail(email)) found.add(email);
  }

  return [...found].sort();
}

function stableId(parts) {
  const raw = parts.filter(Boolean).join("|").slice(0, 400);
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `e${(h >>> 0).toString(36)}`;
}

/**
 * Last-resort upload when an email is visible but no post card can be attached.
 * Prefer `posts.cardToPost` / `findCardForEmail` so author + body are not lost.
 * `metaForEmail(email)` may supply { author, subtitle, description, posted_at, posted_at_text, job_url }.
 */
export function emailsAsSyntheticPosts(
  emails,
  { base = "", keywords = "", urlForEmail = null, metaForEmail = null } = {}
) {
  return (emails || []).map((email) => {
    const meta = (typeof metaForEmail === "function" ? metaForEmail(email) : null) || {};
    let resolved =
      meta.job_url ||
      (typeof urlForEmail === "function" ? urlForEmail(email) : "") ||
      (base && !/\/search\/results\//i.test(base) ? base : "") ||
      "";
    // Never keep LinkedIn search-results URLs as the source link.
    if (/\/search\/results\//i.test(resolved)) resolved = "";
    const activity = /(?:activity|ugcPost|share):(\d{6,})/i.exec(resolved);
    const id = (activity ? `p${activity[1]}` : stableId(["email", email])).slice(0, 64);
    const author = String(meta.author || "").trim();
    const subtitle = String(meta.subtitle || "").trim();
    const posted_at = String(meta.posted_at || "").trim();
    const posted_at_text = String(meta.posted_at_text || "").trim();
    let description = String(meta.description || "").trim();
    if (!description || description.toLowerCase() === String(email).toLowerCase()) {
      description = email;
    } else if (!description.toLowerCase().includes(String(email).toLowerCase())) {
      description = `${description}\n${email}`;
    }
    return {
      linkedin_job_id: id,
      title: author || "LinkedIn search email",
      company: subtitle || "",
      location: "",
      job_url: resolved,
      list_payload: {
        kind: "post",
        author,
        subtitle,
        posted_at,
        posted_at_text,
        email,
        keywords,
        preview: description.slice(0, 280),
        source: "content_search",
      },
      detail_payload: {
        description,
        kind: "post",
        author,
        subtitle,
        posted_at,
        posted_at_text,
        email,
        keywords,
        post_url: resolved,
      },
      detail_status: "fetched",
    };
  });
}
