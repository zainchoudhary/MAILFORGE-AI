# Rich LinkedIn Post Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For email-bearing LinkedIn posts, capture and show poster name, designation, post date/time, permalink, and full post body (View post), without changing Collect’s email-target stop rules.

**Architecture:** Enrich the existing post→job_raw→extract→candidate pipeline. Extension writes richer `list_payload` / `detail_payload`; backend maps designation + date + full body onto candidate fields / `signals`; Studio adds Posted + View post UI. No new DB tables.

**Tech Stack:** Chrome MV3 extension (JS), FastAPI/SQLAlchemy LinkedIn capture, React LinkedIn Finder page.

**Spec:** `docs/superpowers/specs/2026-11-09-rich-post-capture-design.md`

## Global Constraints

- Only posts that yield a public email become leads (Option A).
- No new SQL tables/migrations for v1 — use existing candidate columns + `signals` JSON.
- `source_url` must remain a post permalink (never search URL).
- Full body hard max ~20_000 characters.
- Do not change Collect email-target / hunt stop semantics.
- Prefer TDD; commit only if the user explicitly asks (otherwise leave working tree dirty and note “skip commit”).

## File map

| File | Responsibility |
| --- | --- |
| `extension/src/lib/posts.js` | Parse author, designation, posted_at*, full body into payloads |
| `extension/fixtures/feed-posts.html` | Fixture cards with time + headline |
| `extension/scripts/test_parsers.mjs` | Assert rich fields |
| `backend/app/linkedin_capture/extract.py` | Map subtitle → position; signals.posted_at / post_body |
| `backend/tests/test_linkedin_capture_extract.py` | Extract mapping tests |
| `frontend/src/pages/LinkedInFinder.jsx` | Posted column + View post expand |
| `frontend/src/styles/index.css` | Minimal styles for expand row if needed |

---

### Task 1: Extension — rich post DOM fields

**Files:**
- Modify: `extension/fixtures/feed-posts.html`
- Modify: `extension/src/lib/posts.js`
- Modify: `extension/scripts/test_parsers.mjs`
- Test: `extension/scripts/test_parsers.mjs`

**Interfaces:**
- Consumes: existing `parseVisiblePosts(root, base)` shape
- Produces: each post item includes:
  - `list_payload.author`, `.subtitle`, `.posted_at`, `.posted_at_text`, `.preview`
  - `detail_payload.description` (full body), `.author`, `.subtitle`, `.posted_at`, `.posted_at_text`, `.post_url`, `.kind`

- [ ] **Step 1: Extend the feed fixture with time + longer body**

Update the first card in `extension/fixtures/feed-posts.html` to include:

```html
<div class="feed-shared-update-v2" data-urn="urn:li:activity:7123456789012345678">
  <div class="update-components-actor__name">Alex Rivera</div>
  <div class="update-components-actor__description">Hiring Manager at Northwind</div>
  <a class="update-components-actor__sub-description-link" href="/feed/update/urn:li:activity:7123456789012345678">
    <time datetime="2026-11-08T14:30:00.000Z">1d</time>
  </a>
  <div class="feed-shared-update-v2__description">
    We are hiring a backend engineer. Reach me at alex.rivera@northwind.test or DM.
    Full JD: Python, FastAPI, Postgres. Apply this week.
  </div>
  <a href="/posts/alex-rivera-activity-7123456789012345678-abc">View</a>
</div>
```

- [ ] **Step 2: Write failing parser assertions**

Append to `extension/scripts/test_parsers.mjs` after existing feed asserts:

```js
assert.equal(feedPosts[0].list_payload.subtitle, "Hiring Manager at Northwind");
assert.equal(feedPosts[0].list_payload.posted_at, "2026-11-08T14:30:00.000Z");
assert.equal(feedPosts[0].list_payload.posted_at_text, "1d");
assert.match(feedPosts[0].detail_payload.description, /Full JD: Python/);
assert.equal(feedPosts[0].detail_payload.posted_at, "2026-11-08T14:30:00.000Z");
assert.equal(feedPosts[0].company, "Hiring Manager at Northwind");
```

- [ ] **Step 3: Run test — expect fail**

Run: `cd extension && node scripts/test_parsers.mjs`  
Expected: FAIL on missing `posted_at` / incomplete description mapping.

- [ ] **Step 4: Implement extraction in `posts.js`**

Add selectors and helpers (near existing `POST_SUBTITLE`):

```js
const POST_TIME =
  "time[datetime], .update-components-actor__sub-description time, .feed-shared-actor__sub-description time, a.update-components-actor__sub-description-link time";

function postTime(card) {
  const el = card.querySelector(POST_TIME);
  if (!el) {
    const text = firstMatchText(
      card,
      ".update-components-actor__sub-description, .feed-shared-actor__sub-description, .update-components-actor__meta"
    );
    // Avoid using pure designation lines as "time".
    if (/^\d+\s*[smhdw]|^\d+mo|just now|yesterday|edited/i.test(text)) {
      return { posted_at: "", posted_at_text: text };
    }
    return { posted_at: "", posted_at_text: "" };
  }
  const posted_at = (el.getAttribute("datetime") || "").trim();
  const posted_at_text = clean(el.textContent) || posted_at;
  return { posted_at, posted_at_text };
}
```

In `postBody`, raise full-card slice from `8000` to `20000`.

In `parseVisiblePosts`, after computing `author` / `subtitle` / `body` / `url`:

```js
const { posted_at, posted_at_text } = postTime(card);
// ...
company: subtitle || "",
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
```

- [ ] **Step 5: Run parser tests — expect pass**

Run: `cd extension && node scripts/test_parsers.mjs`  
Expected: `parser tests passed (jobs + link fallback + feed posts)`

- [ ] **Step 6: Commit (only if user asked)**

```bash
git add extension/fixtures/feed-posts.html extension/src/lib/posts.js extension/scripts/test_parsers.mjs
git commit -m "feat(extension): capture post designation, time, and full body"
```

---

### Task 2: Backend extract — map rich post fields onto candidates

**Files:**
- Modify: `backend/app/linkedin_capture/extract.py`
- Modify: `backend/tests/test_linkedin_capture_extract.py`
- Test: `backend/tests/test_linkedin_capture_extract.py`

**Interfaces:**
- Consumes: post `list_payload` / `detail_payload` with `author`, `subtitle`, `posted_at`, `posted_at_text`, `description`
- Produces: `CandidateDraft` with `name`, `position`, `signals.posted_at`, `signals.posted_at_text`, `signals.post_body`

- [ ] **Step 1: Write failing extract test**

Add to `backend/tests/test_linkedin_capture_extract.py`:

```python
def test_post_maps_designation_date_and_full_body_into_candidate():
    body = (
        "Hiring backend. Email alex.rivera@northwind.test\n"
        "Full JD: Python, FastAPI, Postgres. Apply this week."
    )
    drafts = extract_from_job(
        title="Alex Rivera",
        company="Hiring Manager at Northwind",
        location="",
        job_url="https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
        list_payload={
            "kind": "post",
            "author": "Alex Rivera",
            "subtitle": "Hiring Manager at Northwind",
            "posted_at": "2026-11-08T14:30:00.000Z",
            "posted_at_text": "1d",
        },
        detail_payload={
            "kind": "post",
            "author": "Alex Rivera",
            "subtitle": "Hiring Manager at Northwind",
            "posted_at": "2026-11-08T14:30:00.000Z",
            "posted_at_text": "1d",
            "description": body,
        },
        linkedin_job_id="p7123456789012345678",
    )
    assert len(drafts) >= 1
    d = next(x for x in drafts if x.email == "alex.rivera@northwind.test")
    assert d.name == "Alex Rivera"
    assert d.position == "Hiring Manager at Northwind"
    assert d.signals.get("posted_at") == "2026-11-08T14:30:00.000Z"
    assert d.signals.get("posted_at_text") == "1d"
    assert "Full JD: Python" in (d.signals.get("post_body") or "")
```

- [ ] **Step 2: Run test — expect fail**

Run: `cd backend && .venv/bin/pytest tests/test_linkedin_capture_extract.py::test_post_maps_designation_date_and_full_body_into_candidate -v`  
Expected: FAIL (`post_body` / `posted_at` missing from signals).

- [ ] **Step 3: Update `extract_from_job` mapping**

In `backend/app/linkedin_capture/extract.py`, inside the post draft loop (and mirror for `_dropped_email_fallback` when `source_signal == "linkedin_post"`):

```python
author = (detail.get("author") or list_p.get("author") or "").strip()
subtitle = (detail.get("subtitle") or list_p.get("subtitle") or "").strip()
posted_at = (detail.get("posted_at") or list_p.get("posted_at") or "").strip()
posted_at_text = (detail.get("posted_at_text") or list_p.get("posted_at_text") or "").strip()
post_body = (detail.get("description") or list_p.get("description") or text or "").strip()
if len(post_body) > 20000:
    post_body = post_body[:20000]

# in loop:
signals = dict(d.signals or {})
signals["source"] = source_signal
if kind in ("post", "search_email"):
    if posted_at:
        signals["posted_at"] = posted_at[:64]
    if posted_at_text:
        signals["posted_at_text"] = posted_at_text[:80]
    if post_body:
        signals["post_body"] = post_body

position_val = d.position or ("" if kind in ("post", "search_email") else (title or ""))
if kind in ("post", "search_email") and not position_val:
    position_val = subtitle[:200]
```

For `_dropped_email_fallback`, accept optional `list_payload`/`detail_payload` **or** pass the same `signals` extras when `source_signal == "linkedin_post"` by extending the helper signature with `extra_signals: dict | None = None` and merging into each fallback draft’s `signals`.

Minimal approach: after building `out` from drafts + fallback, if `kind in ("post", "search_email")`, loop `out` and set missing signal keys / empty `position` from subtitle.

```python
if kind in ("post", "search_email"):
    enriched = []
    for d in out:
        signals = dict(d.signals or {})
        if posted_at:
            signals["posted_at"] = posted_at[:64]
        if posted_at_text:
            signals["posted_at_text"] = posted_at_text[:80]
        if post_body:
            signals["post_body"] = post_body
        enriched.append(
            CandidateDraft(
                email=d.email,
                name=d.name or author or "",
                company=d.company or company or "",
                position=(d.position or subtitle)[:200],
                source_url=d.source_url,
                source_title=d.source_title or title or author,
                snippet=d.snippet,
                score=d.score,
                signals=signals,
                selected=d.selected,
            )
        )
    out = enriched
```

Place this enrichment once at the end of `extract_from_job` so both primary drafts and fallback drafts get the fields.

- [ ] **Step 4: Run extract tests — expect pass**

Run: `cd backend && .venv/bin/pytest tests/test_linkedin_capture_extract.py -v`  
Expected: all PASS.

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add backend/app/linkedin_capture/extract.py backend/tests/test_linkedin_capture_extract.py
git commit -m "feat(linkedin-capture): map post designation, date, and body onto leads"
```

---

### Task 3: Studio — Posted column + View post

**Files:**
- Modify: `frontend/src/pages/LinkedInFinder.jsx`
- Modify: `frontend/src/styles/index.css` (only if existing lead-row styles need an expand block)
- Test: manual / existing page smoke (no dedicated component test file required)

**Interfaces:**
- Consumes: candidate `position`, `signals.posted_at_text`, `signals.posted_at`, `signals.post_body`, `source_url`
- Produces: table UI with Posted + expandable post body

- [ ] **Step 1: Add helpers above `CandidateRow`**

```jsx
function postedLabel(candidate) {
  const signals = candidate?.signals || {};
  return signals.posted_at_text || signals.posted_at || '';
}

function postBody(candidate) {
  const signals = candidate?.signals || {};
  return signals.post_body || candidate?.snippet || '';
}
```

- [ ] **Step 2: Update `CandidateRow` with expand state + columns**

- Keep Email, Name, Company, Position (designation), Link.
- Add **Posted** column showing `postedLabel(candidate) || '—'`.
- Add a control button “View post” that toggles local `open` state.
- When `open`, render a second `<tr className="lead-post-expand">` with `colSpan` covering the table, showing `<pre>` / plain text of `postBody(candidate)` (or “No post text saved.”).

Sketch:

```jsx
function CandidateRow({ runId, candidate, onChanged, onSelect }) {
  const [open, setOpen] = useState(false);
  // ...existing draft/save logic...
  const when = postedLabel(candidate);
  const body = postBody(candidate);
  return (
    <>
      <tr className={candidate.selected ? 'lead-row selected' : 'lead-row'}>
        {/* existing cells */}
        <td><small>{when || '—'}</small></td>
        <td>
          {candidate.source_url ? (
            <a className="lead-source" href={candidate.source_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} /> Post
            </a>
          ) : <small>—</small>}
        </td>
        <td>
          <button type="button" className="btn ghost tiny" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'View post'}
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="lead-post-expand">
          <td colSpan={8}>
            <div className="lead-post-body">{body || 'No post text saved.'}</div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
```

Align `<thead>` column count (add `Posted` + `Post` or combine View into actions). Prefer headers: Checkbox | Email | Name | Company | Designation | Posted | Link | (empty for View).

Rename Position header label to **Designation** for clarity (field remains `position`).

- [ ] **Step 3: Add minimal CSS**

In `frontend/src/styles/index.css` near other LinkedIn Finder / lead-row rules:

```css
.lead-post-expand td {
  background: color-mix(in srgb, var(--panel, #101827) 92%, transparent);
  border-top: 0;
}
.lead-post-body {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted, #8391aa);
}
```

(If the file already uses theme tokens, match those variable names exactly.)

- [ ] **Step 4: Manual verify**

1. Reload extension + ensure backend running.
2. Collect a small target (e.g. 3 emails) on content search.
3. Open Studio LinkedIn Finder for the run.
4. Confirm designation + posted + View post body appear for new leads.

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add frontend/src/pages/LinkedInFinder.jsx frontend/src/styles/index.css
git commit -m "feat(studio): show post designation, date, and View post body"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Permalink | already + Task 1/2 |
| Poster name | Task 1/2 |
| Designation | Task 1/2 + Task 3 header |
| Post date/time | Task 1/2/3 |
| Full post body + View post | Task 1/2/3 |
| Email-only posts (Option A) | unchanged Collect / extract |
| No new tables | Task 2 uses `signals` |
| Collect stop rules unchanged | no hunt changes |

## Plan self-review

- No TBD/placeholder steps.
- Signal key names consistent: `posted_at`, `posted_at_text`, `post_body`.
- Payload field `subtitle` remains the designation carrier (matches current extract).
