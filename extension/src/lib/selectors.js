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
