// All LinkedIn DOM selectors live here so markup changes only touch one file.
export const SELECTORS = {
  jobCard: ".jobs-search-results__list-item, .scaffold-layout__list-item, li[data-occludable-job-id]",
  title: ".job-card-list__title, a.job-card-container__link",
  company: ".job-card-container__primary-description, .job-card-container__company-name",
  location: ".job-card-container__metadata-item",
  link: "a.job-card-container__link, a.job-card-list__title",
  // Attributes that may carry the numeric job id on the card or a child.
  jobIdAttrs: ["data-job-id", "data-occludable-job-id", "data-entity-urn"],
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

// CAPTCHA / checkpoint heuristics.
export const BLOCK_URL = /\/(checkpoint|authwall|uas\/login-submit|challenge)\b/i;
export const BLOCK_TEXT = /checkpoint|unusual activity|security verification|let'?s do a quick security check|verify (that )?you'?re (not )?a (robot|human)/i;
