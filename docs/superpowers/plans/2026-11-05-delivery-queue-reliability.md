# Delivery Queue Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start approved campaign deliveries promptly by ensuring each queued message has at most one Celery task waiting in Redis.

**Architecture:** `enqueue_deliveries` will acquire a Redis `SET NX` lease before publishing a task. `deliver` clears that lease only after atomically claiming the database message. Beat remains a recovery mechanism, but it cannot flood the queue with duplicates.

**Tech Stack:** Python, Celery, Redis, SQLAlchemy, pytest.

**Spec:** `docs/superpowers/specs/2026-11-05-delivery-queue-reliability-design.md`

## Global Constraints

- Never auto-resend a `sending`/`uncertain` SMTP outcome.
- Preserve direct retry scheduling and periodic recovery.
- Do not purge a queue while database messages are queued or sending.

## Review Focus

- Redis unavailable: publishing remains visible as a worker error rather than silently marking a message dispatched.
- A worker dies after publish: lease expiry enables beat recovery.
- Repeated beat ticks: one database queued row produces one broker task.
- Retry schedules: retry publication bypasses no durable database state.
- Completed messages: stale jobs become no-ops.

---

### Task 1: Deduplicate delivery publication

**Files:**
- Modify: `backend/app/workers/tasks.py`
- Test: `backend/tests/test_reliability.py`

**Interfaces:**
- Produces: `enqueue_deliveries(pending)` publishes only when `delivery-enqueued:<message_id>` can be claimed.

- [ ] Add a failing test with a fake Redis client proving two enqueue calls for one message publish exactly once.
- [ ] Run the focused test and confirm it fails because publication is currently unconditional.
- [ ] Add a 5-minute `SET NX` enqueue lease and publish only on successful acquisition.
- [ ] Clear the lease after `deliver` claims a message for processing.
- [ ] Run focused and full backend tests.

### Task 2: Recover the current queue safely

**Files:**
- No source file changes.

- [ ] Query live database message states before cleanup.
- [ ] Purge Redis `celery` queue only when no rows are `queued` or `sending`.
- [ ] Recheck queue depth and send a fresh campaign to verify immediate task start.
