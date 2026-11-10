// Parser unit test: runs in plain Node (no Chrome). Uses linkedom (devDependency)
// to build a DOM from fixtures/jobs-list.html and exercises the real parser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseHTML } from "linkedom";
import { parseVisibleJobs, extractJobId, canonicalJobUrl } from "../src/lib/parse.js";
import {
  parseVisiblePosts,
  cardToPost,
  findCardForEmail,
  parseFeedPostHeader,
  cleanAuthor,
  preferAuthor,
  companyFromSubtitle,
  companyFromBody,
  authorFromProfileHref,
  stripPostChrome,
  resolvePostPermalink,
  closestPostContainer,
  isolatePostSegment,
  postBody,
  urlFromActivityUrn,
  isPostPermalink,
} from "../src/lib/posts.js";

const here = dirname(fileURLToPath(import.meta.url));
assert.equal(urlFromActivityUrn('urn:li:share:7524577087303880704'), '', 'share IDs are not verified post URLs');
assert.equal(isPostPermalink('https://lnkd.in/p/dZa85pXX'), true);
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
  "https://www.linkedin.com/posts/alex-rivera-activity-7123456789012345678-abc/"
);
assert.match(feedPosts[1].detail_payload.description, /careers@orbitlabs\.example/);
assert.equal(
  feedPosts[1].job_url,
  "https://www.linkedin.com/feed/update/urn:li:activity:7987654321098765432/"
);

assert.equal(feedPosts[0].list_payload.subtitle, "Hiring Manager at Northwind");
assert.equal(feedPosts[0].list_payload.posted_at, "2026-11-08T14:30:00.000Z");
assert.equal(feedPosts[0].list_payload.posted_at_text, "1d");
assert.match(feedPosts[0].detail_payload.description, /Full JD: Python/);
assert.equal(feedPosts[0].detail_payload.posted_at, "2026-11-08T14:30:00.000Z");
assert.equal(feedPosts[0].company, "Northwind");

const card = feedDoc.querySelector('[data-urn="urn:li:activity:7123456789012345678"]');
const found = findCardForEmail(feedDoc, "alex.rivera@northwind.test");
assert.equal(found, card);
const fromCard = cardToPost(card, "https://www.linkedin.com");
assert.equal(fromCard.list_payload.author, "Alex Rivera");
assert.equal(fromCard.list_payload.subtitle, "Hiring Manager at Northwind");
assert.match(fromCard.detail_payload.description, /alex\.rivera@northwind\.test/);

// Content-search style wrappers (no classic feed-shared-update-v2 on outer node).
const looseHtml = readFileSync(join(here, "../fixtures/content-search-loose.html"), "utf8");
const { document: looseDoc } = parseHTML(looseHtml);
const loosePosts = parseVisiblePosts(looseDoc, "https://www.linkedin.com");
assert.ok(loosePosts.length >= 2, "loose content-search cards must parse");
const ayesha = loosePosts.find((p) => /ayeshaasim@businessupscalers\.com/i.test(p.detail_payload.description));
assert.ok(ayesha, "email post from chameleon wrapper");
assert.equal(ayesha.list_payload.author, "Ayesha Asim");
assert.match(ayesha.list_payload.subtitle, /Business Upscalers/i);
assert.equal(ayesha.list_payload.posted_at_text, "2d");
assert.equal(
  ayesha.job_url,
  "https://www.linkedin.com/posts/ayesha-asim-activity-8111111111111111111-AbCd/"
);

const viaWalk = findCardForEmail(looseDoc, "careers@hytgenx.ai");
assert.ok(viaWalk, "TreeWalker must find card for careers@hytgenx.ai");
const hyt = cardToPost(viaWalk, "https://www.linkedin.com");
assert.equal(hyt.list_payload.author, "Sam Recruiter");
assert.match(hyt.detail_payload.description, /careers@hytgenx\.ai/);

const header = parseFeedPostHeader(
  "Feed post Muhammad Zubair • 2nd Customer Experience & Operations Leader | Support 2h Follow Hiring"
);
assert.equal(header.author, "Muhammad Zubair");
assert.match(header.subtitle, /Customer Experience/);
assert.equal(header.posted_at_text, "2h");
const headerLoose = parseFeedPostHeader(
  "Abbas • 2nd Strategic HR Leader | Driving Workforce Transformation 8h · Visible to anyone"
);
assert.equal(headerLoose.author, "Abbas");
assert.match(headerLoose.subtitle, /Strategic HR Leader/);
assert.equal(headerLoose.posted_at_text, "8h");
const fatima = parseFeedPostHeader(
  "Noise before Fatima Khan • 2nd Talent Lead at Acme Corp 3h Follow Hiring now"
);
assert.equal(fatima.author, "Fatima Khan");
assert.equal(preferAuthor("Khan", "Fatima Khan"), "Fatima Khan");
assert.equal(companyFromSubtitle("Founder & CEO @ Databiqs"), "Databiqs");
assert.equal(companyFromSubtitle("Hiring Manager at Northwind"), "Northwind");
assert.equal(companyFromSubtitle("Strategic HR Leader | Driving change"), "");
assert.equal(cleanAuthor("View Fatima Khawaja’s profile"), "Fatima Khawaja");
assert.equal(cleanAuthor("Live Demos"), "");
assert.equal(cleanAuthor("Working Hours"), "");
assert.equal(cleanAuthor("Lahore Location"), "");

// Nested commentary: email text has no urn/link; parent card does — must still bind permalink.
const nestedHtml = readFileSync(join(here, "../fixtures/content-search-nested-email.html"), "utf8");
const { document: nestedDoc } = parseHTML(nestedHtml);
const emailNode = [...nestedDoc.querySelectorAll("span")].find((el) =>
  /hr@databiqs\.com/i.test(el.textContent || "")
);
assert.ok(emailNode, "nested email text node");
const climbed = closestPostContainer(emailNode);
assert.ok(climbed, "closestPostContainer from email text");
assert.match(climbed.getAttribute("data-chameleon-result-urn") || "", /8333333333333333333/);
assert.equal(
  resolvePostPermalink(emailNode, "https://www.linkedin.com"),
  "https://www.linkedin.com/posts/jaffar-ali-activity-8333333333333333333-XyZ9/"
);
const nestedCard = findCardForEmail(nestedDoc, "hr@databiqs.com");
assert.ok(nestedCard, "findCardForEmail must find nested email post");
const nestedPost = cardToPost(nestedCard, "https://www.linkedin.com");
assert.ok(nestedPost, "cardToPost for nested email");
assert.equal(
  nestedPost.job_url,
  "https://www.linkedin.com/posts/jaffar-ali-activity-8333333333333333333-XyZ9/"
);
assert.equal(nestedPost.detail_payload.post_url, nestedPost.job_url);
assert.match(nestedPost.detail_payload.description, /hr@databiqs\.com/i);

// A missing permalink must never borrow the next search result's post link.
const { document: siblingsDoc } = parseHTML(`
  <main>
    <article class="feed-shared-update-v2" id="email-post">
      <span id="email-text">Apply: hiring@example.com</span>
    </article>
    <article class="feed-shared-update-v2" data-urn="urn:li:activity:9999999999999999999">
      <a href="/posts/another-activity-9999999999999999999-abcd/">Other post</a>
    </article>
  </main>`);
const ownCard = siblingsDoc.querySelector('#email-post');
const ownEmail = siblingsDoc.querySelector('#email-text');
assert.equal(resolvePostPermalink(ownEmail), '', 'do not borrow a sibling permalink');
assert.equal(resolvePostPermalink(ownCard), '', 'card lookup must not borrow a sibling permalink');
assert.equal(closestPostContainer(ownEmail), ownCard, 'keep email attached to its own card');

// Search wrappers can match POST_CARD while containing several independent posts.
const { document: groupedDoc } = parseHTML(`<div class="reusable-search__result-container">
  <div class="feed-shared-update-v2" data-urn="urn:li:activity:8111111111111111111">
    <div class="update-components-text">First role: first@example.com</div>
  </div>
  <div class="feed-shared-update-v2" data-urn="urn:li:activity:8222222222222222222">
    <div class="update-components-text">Second role with a longer description: second@example.com</div>
  </div>
</div>`);
const groupedPosts = parseVisiblePosts(groupedDoc);
assert.equal(groupedPosts.length, 2, 'shared wrapper must not collapse independent posts');
for (const [email, id] of [['first@example.com', '8111111111111111111'], ['second@example.com', '8222222222222222222']]) {
  const bound = cardToPost(findCardForEmail(groupedDoc, email), undefined, { email });
  assert.equal(bound.job_url, `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`);
  assert.ok(bound.detail_payload.description.includes(email));
}

// A URL mentioned in the body is not the source post's permalink.
const { document: linkedDoc } = parseHTML(`<div class="feed-shared-update-v2" data-urn="urn:li:activity:8111111111111111111">
  <div class="update-components-text">Apply first@example.com <a href="/posts/other-activity-8222222222222222222-abcd">Related post</a></div>
  <a class="update-components-actor__sub-description-link" href="/feed/update/urn%3Ali%3Aactivity%3A8111111111111111111/">2h</a>
</div>`);
assert.equal(resolvePostPermalink(linkedDoc.querySelector('div')),
  'https://www.linkedin.com/feed/update/urn:li:activity:8111111111111111111/');
linkedDoc.querySelector('div').removeAttribute('data-urn');
assert.equal(resolvePostPermalink(linkedDoc.querySelector('div')),
  'https://www.linkedin.com/feed/update/urn:li:activity:8111111111111111111/',
  'encoded timestamp link identifies the source even when the card has no URN');

// Multi-post mashup: body must stay on the email's own post, not siblings.
const mashed =
  "Feed post Faisalabad Education • 1st Hiring locally 2h Follow Need a salesman — WhatsApp only. " +
  "Feed post Verena Distler • 3rd+ Assistant Professor | HCI 3d Follow " +
  "I am recruiting a PhD student at Aalto University! Interested: reach hr@deepailogics.com today.";
const isolated = isolatePostSegment(mashed, "hr@deepailogics.com");
assert.match(isolated, /Verena Distler/);
assert.match(isolated, /hr@deepailogics\.com/);
assert.doesNotMatch(isolated, /Faisalabad Education|WhatsApp only/i);

const mashHtml = `<!doctype html><html><body>
  <div data-chameleon-result-urn="urn:li:activity:8444444444444444444" class="search-results-container">
    <div class="update-components-text break-words">Salesman role in Faisalabad. Contact local office.</div>
    <div class="update-components-text break-words">PhD opening — email hr@deepailogics.com for the Aalto role.</div>
  </div>
</body></html>`;
const { document: mashDoc } = parseHTML(mashHtml);
const mashCard = mashDoc.querySelector("[data-chameleon-result-urn]");
const mashBody = postBody(mashCard, { email: "hr@deepailogics.com" });
assert.match(mashBody, /hr@deepailogics\.com/);
assert.doesNotMatch(mashBody, /Salesman role in Faisalabad/i);
const mashPost = cardToPost(mashCard, "https://www.linkedin.com", { email: "hr@deepailogics.com" });
assert.match(mashPost.detail_payload.description, /hr@deepailogics\.com/);
assert.doesNotMatch(mashPost.detail_payload.description, /Salesman role in Faisalabad/i);

// Halima Ehsan / TechPrysm: full name from profile, company from body, chrome-free body.
assert.equal(authorFromProfileHref("/in/halima-ehsan-123456789/"), "Halima Ehsan");
assert.equal(companyFromBody("Hiring at TechPrysm! Location: DHA Phase 8"), "TechPrysm");
assert.equal(companyFromBody("Join Acme Robotics — we're growing"), "Acme Robotics");
assert.equal(
  companyFromBody(
    "We're looking for a talented SEO CONTENT WRITER to join our growing team at BIZSCALE! Location: Lahore"
  ),
  "BIZSCALE"
);
assert.equal(authorFromProfileHref("/posts/ayesha-sibtain-abbas-activity-8888888888888888888-AbCd/"), "Ayesha Sibtain Abbas");
const chromeBody =
  "Ehsan • 2nd HR Executive & Talent Acquisition Specialist | Full-Cycle IT Recruitment | " +
  "LinkedIn Headhunting | HRIS & HR Ops | Open to Remote 7h Connect Hiring at TechPrysm! " +
  "Apply at: careers@techprysm.com … more 56 11 4";
const cleaned = stripPostChrome(chromeBody);
assert.match(cleaned, /^Hiring at TechPrysm!/);
assert.doesNotMatch(cleaned, /•\s*2nd|^\s*Ehsan\b|7h Connect|… more|56 11 4/i);
assert.equal(companyFromBody(cleaned), "TechPrysm");

const halimaHtml = readFileSync(join(here, "../fixtures/content-search-halima-techprysm.html"), "utf8");
const { document: halimaDoc } = parseHTML(halimaHtml);
const halimaCard = findCardForEmail(halimaDoc, "careers@techprysm.com");
assert.ok(halimaCard, "Halima TechPrysm card");
const halima = cardToPost(halimaCard, "https://www.linkedin.com", { email: "careers@techprysm.com" });
assert.ok(halima, "cardToPost Halima");
assert.equal(halima.list_payload.author, "Halima Ehsan");
assert.equal(halima.company, "TechPrysm");
assert.match(halima.list_payload.subtitle, /HR Executive & Talent Acquisition Specialist/);
assert.match(halima.detail_payload.description, /^Hiring at TechPrysm!/);
assert.doesNotMatch(halima.detail_payload.description, /•\s*2nd|7h Connect|… more|56 11 4/i);
assert.match(halima.detail_payload.description, /careers@techprysm\.com/i);

const ayeshaHtml = readFileSync(join(here, "../fixtures/content-search-ayesha-bizscale.html"), "utf8");
const { document: ayeshaDoc } = parseHTML(ayeshaHtml);
const ayeshaCard = findCardForEmail(ayeshaDoc, "ayeshaasim@businessupscalers.com");
assert.ok(ayeshaCard, "Ayesha BIZSCALE card");
assert.match(ayeshaCard.getAttribute("data-chameleon-result-urn") || "", /8888888888888888888/);
const ayeshaPost = cardToPost(ayeshaCard, "https://www.linkedin.com", {
  email: "ayeshaasim@businessupscalers.com",
});
assert.ok(ayeshaPost, "cardToPost Ayesha");
assert.equal(ayeshaPost.list_payload.author, "Ayesha Sibtain Abbas");
assert.match(ayeshaPost.list_payload.subtitle, /Strategic HR Leader/);
assert.equal(ayeshaPost.list_payload.posted_at_text, "6h");
assert.equal(ayeshaPost.company, "BIZSCALE");
assert.doesNotMatch(ayeshaPost.company, /growing|team|our/i);
assert.match(ayeshaPost.detail_payload.description, /SEO CONTENT WRITER/i);
assert.match(ayeshaPost.detail_payload.description, /ayeshaasim@businessupscalers\.com/i);

console.log("parser tests passed (jobs + link fallback + feed posts + nested permalink + body isolate)");
