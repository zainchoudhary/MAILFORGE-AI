// All LinkedIn DOM selectors live here so markup changes only touch one file.
export const SELECTORS = {
  // LinkedIn markup drifts often — keep this list broad; parse.js also falls back to /jobs/view/ links.
  jobCard:
    ".jobs-search-results__list-item, .scaffold-layout__list-item, li[data-occludable-job-id], .job-card-container, .jobs-search-results-list__list-item, li.ember-view.jobs-search-results__list-item",
  title:
    ".job-card-list__title, a.job-card-container__link, .job-card-list__title--link, a.job-card-list__title-link, .artdeco-entity-lockup__title a",
  company:
    ".job-card-container__primary-description, .job-card-container__company-name, .artdeco-entity-lockup__subtitle, .job-card-container__primary-description--link",
  location: ".job-card-container__metadata-item, .job-card-container__metadata-wrapper li, .artdeco-entity-lockup__caption",
  link: 'a.job-card-container__link, a.job-card-list__title, a.job-card-list__title-link, a[href*="/jobs/view/"]',
  // Attributes that may carry the numeric job id on the card or a child.
  jobIdAttrs: ["data-job-id", "data-occludable-job-id", "data-entity-urn", "data-job-id-str"],
  // Last-resort discovery when card class names changed.
  jobViewLinks: 'a[href*="/jobs/view/"]',
};

export const JOB_ID_FROM_URL = /\/jobs\/view\/(?:[^/?#]*-)?(\d+)/;
export const JOB_ID_FROM_QUERY = /[?&]currentJobId=(\d+)/;

// --- Task 6: deep capture + detail pane ---
export const DETAIL_SELECTORS = {
  // Job description body (first match wins, in document order of preference).
  description: ".jobs-description__content, .jobs-box__html-content, .jobs-description-content__text, #job-details",
  // Whole right-hand detail pane (used for raw_text).
  pane: ".jobs-search__job-details--container, .scaffold-layout__detail, .job-view-layout",
  // "See more" toggle that truncates long descriptions.
  seeMore: "button.jobs-description__footer-button, button[aria-label='Click to see more description']",
  mailto: "a[href^='mailto:']",
  // Left-hand list scroller and pagination.
  listScroller: ".jobs-search-results-list, .scaffold-layout__list > div, .scaffold-layout__list",
  nextPage: "button.jobs-search-pagination__button--next, button[aria-label='View next page']",
};

// CAPTCHA / checkpoint heuristics. Matched against the URL *path* and challenge UI only,
// never the whole page text (job descriptions can legitimately say "checkpoint").
export const BLOCK_URL = /\/(checkpoint|authwall|uas\/login-submit|challenge)(\/|$|\?)/i;
export const BLOCK_SELECTORS = [
  "#captcha-internal",
  "#challenge-form",
  ".captcha-container",
  ".challenge-dialog",
  "[data-test-id='challenge']",
  "form[action*='/checkpoint/']",
  "iframe[src*='captcha']",
  "iframe[src*='/checkpoint/']",
].join(", ");
// Only checked in headings of pages that show no job description (i.e. not a job view).
export const BLOCK_HEADING = /unusual activity|security verification|let'?s do a quick security check|verify (that )?you'?re (not )?a (robot|human)/i;
export const BLOCK_HEADING_SELECTOR = "h1, h2";
