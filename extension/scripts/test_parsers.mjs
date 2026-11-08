// Parser unit test: runs in plain Node (no Chrome). Uses linkedom (devDependency)
// to build a DOM from fixtures/jobs-list.html and exercises the real parser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseHTML } from "linkedom";
import { parseVisibleJobs, extractJobId, canonicalJobUrl } from "../src/lib/parse.js";
import { parseVisiblePosts } from "../src/lib/posts.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../fixtures/jobs-list.html"), "utf8");
const { document } = parseHTML(html);

const jobs = parseVisibleJobs(document, "https://www.linkedin.com");

assert.equal(jobs.length, 2, "2 unique job cards (ad skipped, duplicate removed)");

const [a, b] = jobs;
assert.equal(a.linkedin_job_id, "3900000001");
assert.equal(a.title, "Senior Backend Engineer");
assert.equal(a.company, "Acme Robotics");
assert.equal(a.location, "Berlin, Germany (Hybrid)");
assert.equal(a.job_url, "https://www.linkedin.com/jobs/view/3900000001/");
assert.equal(a.list_payload.source, "list_card");

assert.equal(b.linkedin_job_id, "3900000002");
assert.equal(b.title, "Data Analyst");
assert.equal(b.company, "Globex Corp");
assert.equal(b.location, "Remote");
assert.equal(b.job_url, "https://www.linkedin.com/jobs/view/3900000002/");

// Helper edge cases
assert.equal(extractJobId({ href: "/jobs/view/123456789/?x=1" }), "123456789");
assert.equal(extractJobId({ href: "/jobs/search/?currentJobId=987654321&q=x" }), "987654321");
assert.equal(extractJobId({ attrValues: ["urn:li:jobPosting:555555555"] }), "555555555");
assert.equal(extractJobId({}), "");
assert.equal(canonicalJobUrl("", "/foo/bar?x=1"), "https://www.linkedin.com/foo/bar");

// Fallback when LinkedIn drops classic job-card class names.
const linksOnly = readFileSync(join(here, "../fixtures/jobs-list-links-only.html"), "utf8");
const { document: linkDoc } = parseHTML(linksOnly);
const fromLinks = parseVisibleJobs(linkDoc, "https://www.linkedin.com");
assert.equal(fromLinks.length, 2, "link fallback finds /jobs/view/ anchors");
assert.equal(fromLinks[0].linkedin_job_id, "4000000001");
assert.equal(fromLinks[0].list_payload.source, "jobs_view_link");
assert.equal(fromLinks[1].linkedin_job_id, "4000000002");

const feedHtml = readFileSync(join(here, "../fixtures/feed-posts.html"), "utf8");
const { document: feedDoc } = parseHTML(feedHtml);
const feedPosts = parseVisiblePosts(feedDoc, "https://www.linkedin.com");
assert.equal(feedPosts.length, 3, "three feed posts parsed");
assert.equal(feedPosts[0].list_payload.kind, "post");
assert.equal(feedPosts[0].detail_status, "fetched");
assert.match(feedPosts[0].detail_payload.description, /alex\.rivera@northwind\.test/);
assert.equal(feedPosts[0].title, "Alex Rivera");
assert.equal(
  feedPosts[0].job_url,
  "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/"
);
assert.match(feedPosts[1].detail_payload.description, /careers@orbitlabs\.example/);
assert.equal(
  feedPosts[1].job_url,
  "https://www.linkedin.com/feed/update/urn:li:activity:7987654321098765432/"
);

console.log("parser tests passed (jobs + link fallback + feed posts)");
