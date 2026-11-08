// Parser unit test: runs in plain Node (no Chrome). Uses linkedom (devDependency)
// to build a DOM from fixtures/jobs-list.html and exercises the real parser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseHTML } from "linkedom";
import { parseVisibleJobs, extractJobId, canonicalJobUrl } from "../src/lib/parse.js";

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

console.log("parser tests passed (2 cards parsed, ad skipped, duplicate removed)");
