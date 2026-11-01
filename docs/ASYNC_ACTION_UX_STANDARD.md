# Async Action UX Standard

## Purpose

Every API-backed action must communicate the real server state. The interface must never report
success when the server has only accepted, queued, or started an operation.

## Action lifecycle

1. **Idle** — controls are available.
2. **Submitting** — disable the triggering control and lock the related modal. Show a spinner and
   an action-specific label such as `Saving…`, `Deleting…`, or `Uploading…`.
3. **Accepted/queued** — use neutral copy such as `Analysis queued` only when the operation is
   asynchronous. Do not show a success toast yet.
4. **Processing** — poll or subscribe to the server-owned status. Keep the relevant panel visible
   with an inline progress/status indicator.
5. **Completed** — update the query cache from confirmed server data, render the new state, then
   show one success toast.
6. **Failed** — stop loading, keep the modal/panel open where applicable, show a meaningful error,
   and allow retry. Never remove optimistic data without restoring the previous state.

## Modal rules

- A modal closes only after the awaited backend operation and required cache synchronization finish.
- Escape, close, cancel, and submit controls are disabled while a mutation is pending.
- Confirmation components must use `mutateAsync`, not fire-and-forget `mutate`.
- Destructive actions use one request/transaction for bulk operations.

## Toast rules

- Toasts are confirmations, not progress indicators.
- Upload success means the file was stored; extraction success means records were actually completed.
- Long-running work uses an inline status or loading toast, followed by exactly one completion toast.
- Error toasts use safe, human-readable backend messages.

## Cache synchronization

- Invalidate the smallest relevant query prefix after a confirmed mutation.
- Use optimistic updates only for reversible, low-risk local state changes; rollback on failure.
- Do not invalidate the entire application after a single record mutation.

## Document extraction flow

`upload -> upload confirmed -> extraction queued -> worker processing -> extraction completed ->
records rendered -> completion toast`

The completion toast belongs to the final `extraction completed` transition, never the initial
`POST /documents/{id}/extract` response.

## Verified defects and current coverage

| Area | Defect | Implemented correction |
| --- | --- | --- |
| Recipient import | Visible worker results differed from the submitted edit buffer; zero requests could report success | Both screens use shared reviewed-row import logic; null means unedited, empty means intentionally empty |
| Import feedback | Static success text concealed zero additions or duplicates | Report added/existing counts; reject empty selections; report partial failure |
| Action buttons | A supplied disabled prop could override pending protection | Pending state wins over supplied props |
| Modal controls | Close was locked but child actions remained usable | Disabled fieldset and inert content while pending |
| Upload modal | Parent did not know child upload was running | Upload busy state propagated to parent; single-file picker matches the review workflow |
| Mutations | Same-tick clicks could submit twice | Shared in-flight promise guard |
| Queries | Abandoned requests continued running | Query cancellation signal forwarded to Axios |
| Auth refresh | Refresh URL ignored configured API origin | Refresh uses configured base URL and timeout |
| Campaign/compose | Modal closure/navigation preceded synchronization | Completion callbacks run after refresh |

### Validation and limits

Regression tests cover untouched extracted rows, intentional empty selection, duplicate-only imports,
partial failures, duplicate clicks, and cache synchronization before completion feedback.
Production compilation must finish with exit code zero; starting a build is not a passed build.

Live Neon latency, worker availability, SMTP delivery and every browser interaction are not certified
by these unit tests. Imports still perform sequential recipient writes; a transactional bulk import
endpoint remains a performance opportunity. Other mutations retain conservative global invalidation
unless explicitly scoped. Database integration tests must only target an isolated test database.
