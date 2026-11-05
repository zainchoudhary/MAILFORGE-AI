# Bulk Delete Campaigns & Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select bulk delete on Campaigns and Recipient groups, with clear toasts when active campaigns cannot be deleted (single + bulk).

**Architecture:** Mirror existing `POST /recipients/bulk-delete` and Documents UI. Add `POST /campaigns/bulk-delete` and `POST /recipient-groups/bulk-delete`. Reuse single-delete cascade. Frontend selection mode matches Recipients.

**Tech Stack:** FastAPI, SQLAlchemy, React, React Query, sonner toasts.

## Global Constraints

- Email activity bulk delete is out of scope
- Blocked campaign statuses: `processing`, `sending`, `scheduled`
- Group delete removes group + memberships only; contacts stay
- Do not commit unless the user asks

---

### Task 1: Backend campaign bulk delete + clearer single-delete message

**Files:**
- Modify: `backend/app/schemas/inputs.py`
- Modify: `backend/app/api/v1/campaigns.py`
- Test: `backend/tests/test_workflow.py` (or add focused tests)

- [ ] Add `BulkCampaignDelete` with `campaign_ids: list[str]`
- [ ] Extract shared delete helper or inline cascade from `delete_campaign`
- [ ] Single delete: raise 409 with status-aware text e.g. `This campaign is processing and can't be deleted right now.`
- [ ] Bulk: delete allowed, skip blocked, return `{ ok, deleted, skipped }`
- [ ] Verify with pytest

### Task 2: Backend recipient-group bulk delete

**Files:**
- Modify: `backend/app/schemas/inputs.py`
- Modify: `backend/app/api/v1/resources.py`

- [ ] Add `BulkRecipientGroupDelete` with `group_ids: list[str]`
- [ ] `POST /recipient-groups/bulk-delete` deletes groups + memberships, returns `{ ok, deleted }`

### Task 3: Campaigns UI multi-select + toast

**Files:**
- Modify: `frontend/src/pages/Campaigns.jsx`

- [ ] Selection mode like Recipients
- [ ] Bulk delete confirm + call bulk API; toast deleted/skipped
- [ ] Single delete: surface API detail toast (already via useAction); ensure wording from API is clear

### Task 4: Recipient groups UI multi-select

**Files:**
- Modify: `frontend/src/pages/RecipientGroups.jsx`
- Modify: `frontend/src/styles/index.css` if card checkbox needs a touch

- [ ] Select multiple on group cards
- [ ] Bulk delete confirm + API
