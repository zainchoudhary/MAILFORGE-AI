# Delivery Queue Reliability Design

## Intent

Campaign delivery must start promptly after approval and must not be delayed by duplicate Celery jobs. Temporary worker or broker issues must recover without flooding Redis.

## Evidence

- A campaign approved at 12:09 PK started at 12:18 PK.
- Redis contained 2,476 pending `celery` tasks while only four campaign messages existed.
- Beat calls `dispatch` every second and previously re-enqueued every database row with `status="queued"`.

## Chosen approach

Use a Redis per-message enqueue lock. A message can have one queued Celery job at a time. The lock expires after a bounded recovery window so beat can recover work if a worker/broker dies. The delivery task clears the lock only after it has claimed the database message.

## Scope

- Prevent duplicate dispatches from approval, beat, and retry paths.
- Keep direct retry scheduling and beat recovery.
- Safely purge the existing duplicate queue only after confirming no active database messages.
- Keep SMTP provider failures visible rather than pretending delivery succeeded.

## Non-goals

- Changing SMTP provider acceptance behavior.
- Re-sending uncertain SMTP outcomes, which could create duplicates.
