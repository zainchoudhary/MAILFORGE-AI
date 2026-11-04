# Recipient Group Preview and Searchable Dropdowns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only recipient-group previews and consistent searchable selection controls where option lists benefit from search.

**Architecture:** Extend the existing custom picker instead of adding a second dropdown pattern. Use current recipient/group APIs for the preview dialog, and keep the group preview state local to `RecipientGroups.jsx`. Migrate only data-driven controls; short fixed controls remain native/custom compact controls.

**Tech Stack:** React 18, React Router, TanStack Query, Vitest, FastAPI, SQLAlchemy.

**Spec:** `docs/superpowers/specs/2026-11-04-group-preview-searchable-dropdowns-design.md`

## Global Constraints

- Preserve existing APIs, routing, validation, and selection behavior.
- Search is case-insensitive and filters both option labels and descriptions.
- Preview dialogs are read-only and never mutate membership.
- Single-recipient copy uses singular grammar; bulk copy uses plural grammar.

## Review Focus

- Empty search results must show an explanatory empty state; test in Task 1.
- Selecting an option must close the dropdown and preserve the selected value; test in Task 1.
- Preview must never expose recipients outside the signed-in organization; test in Task 2.
- Preview with no resolvable members must show a safe empty state; test in Task 2.
- Short fixed option controls must retain their existing compact behavior; verify in Task 3.

---

### Task 1: Reusable searchable picker

**Files:**
- Modify: `frontend/src/components/Common.jsx`
- Modify: `frontend/src/styles/index.css`
- Test: `frontend/src/components/Common.test.jsx`

**Interfaces:**
- Produces: `PickerDropdown({ value, onChange, options, searchable, searchPlaceholder, ... })` where each option supports `label`, `description`, and `searchTerms`.
- Consumes: existing picker call sites without requiring changes when `searchable` is false.

- [ ] Write failing tests for case-insensitive filtering, empty results, and selection after filtering.
- [ ] Run the component test and confirm it fails because search is absent.
- [ ] Add optional search behavior, accessible result status, and existing close behavior.
- [ ] Add the picker search styles.
- [ ] Run `npm test -- --run src/components/Common.test.jsx` and confirm pass.
- [ ] Commit the task.

### Task 2: Recipient group preview and deletion copy

**Files:**
- Modify: `frontend/src/pages/RecipientGroups.jsx`
- Modify: `frontend/src/pages/Recipients.jsx`
- Modify: `frontend/src/styles/index.css`
- Test: `frontend/src/pages/RecipientGroups.test.jsx`

**Interfaces:**
- Produces: a read-only preview dialog opened from a group card and backed by the group’s existing `recipient_ids` plus recipient list.
- Consumes: `RecipientGroups` query data and current recipient list endpoint.

- [ ] Write failing tests for Preview opening, member rendering, and zero-member fallback.
- [ ] Run the focused test and confirm failure.
- [ ] Add the preview action/dialog and local preview target state.
- [ ] Replace the single-delete no-group sentence with singular copy while retaining plural bulk copy.
- [ ] Run focused tests and confirm pass.
- [ ] Commit the task.

### Task 3: Migrate data-driven dropdowns

**Files:**
- Modify: `frontend/src/pages/Compose.jsx`
- Modify: `frontend/src/pages/Templates.jsx`
- Modify: `frontend/src/pages/Activity.jsx`
- Modify: `frontend/src/pages/Campaigns.jsx`
- Modify: `frontend/src/pages/Studio.jsx`
- Test: relevant existing page/component tests or new focused tests where missing.

**Interfaces:**
- Consumes: searchable `PickerDropdown` from Task 1.
- Produces: searchable recipient-group, campaign, sender, template, attachment, and other data-backed pickers while leaving short static controls unchanged.

- [ ] Inventory each data-backed picker and write a focused failing test for one representative migration path.
- [ ] Run the focused test and confirm failure.
- [ ] Migrate data-backed custom and native dropdowns using shared picker options/search terms.
- [ ] Verify fixed short controls retain existing UI.
- [ ] Run `npm test` and `npm run build` from `frontend` and confirm pass.
- [ ] Commit the task.
