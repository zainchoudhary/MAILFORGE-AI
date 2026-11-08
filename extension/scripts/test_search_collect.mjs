import assert from "node:assert/strict";
import {
  processKeywords,
  buildContentSearchUrl,
  detectCollectionContext,
  keywordsMatch,
  getUrlSearchKeywords,
  extractEmailsFromDocument,
  emailsAsSyntheticPosts,
  isValidEmail,
} from "../src/lib/searchCollect.js";
import { parseHTML } from "linkedom";

assert.equal(processKeywords("python, mumbai"), '"python" AND "mumbai"');
assert.equal(processKeywords("  react , frontend  "), '"react" AND "frontend"');
assert.equal(processKeywords(""), "");

const url = buildContentSearchUrl('"python" AND "mumbai"');
assert.match(url, /linkedin\.com\/search\/results\/content\//);
assert.match(url, /sortBy=date_posted/);
assert.ok(url.includes(encodeURIComponent('"python" AND "mumbai"')));

assert.equal(
  detectCollectionContext("https://example.com", '"a" AND "b"'),
  "offLinkedIn"
);
assert.equal(
  detectCollectionContext("https://www.linkedin.com/feed/", '"a"'),
  "linkedInOther"
);

const searchReady =
  "https://www.linkedin.com/search/results/content/?keywords=%22python%22%20AND%20%22mumbai%22&sortBy=date_posted";
assert.equal(detectCollectionContext(searchReady, '"python" AND "mumbai"'), "searchReady");
assert.equal(
  detectCollectionContext(searchReady, '"react" AND "hiring"'),
  "searchMismatch"
);

assert.ok(keywordsMatch(getUrlSearchKeywords(searchReady), '"python" AND "mumbai"'));
assert.ok(isValidEmail("a@b.co"));
assert.ok(!isValidEmail("not-an-email"));

const { document } = parseHTML(`<!doctype html><html><body>
  Contact me at hire@acme.com or <a href="mailto:jobs@acme.com">email</a>
</body></html>`);
const emails = extractEmailsFromDocument(document);
assert.deepEqual(emails, ["hire@acme.com", "jobs@acme.com"]);

const synth = emailsAsSyntheticPosts(["hire@acme.com"], {
  keywords: "hiring",
  urlForEmail: () => "https://www.linkedin.com/feed/update/urn:li:activity:123/",
});
assert.equal(synth.length, 1);
assert.equal(synth[0].detail_payload.description, "hire@acme.com");
assert.equal(synth[0].list_payload.source, "content_search");
assert.equal(synth[0].job_url, "https://www.linkedin.com/feed/update/urn:li:activity:123/");
assert.equal(synth[0].list_payload.kind, "post");

const noUrl = emailsAsSyntheticPosts(["x@y.com"], {
  keywords: "hiring",
  urlForEmail: () => "https://www.linkedin.com/search/results/content/?keywords=x",
});
assert.equal(noUrl.length, 1);
assert.equal(noUrl[0].job_url, "", "search URLs must be stripped, email still kept");
assert.equal(noUrl[0].detail_payload.description, "x@y.com");

console.log("test_search_collect: ok");
