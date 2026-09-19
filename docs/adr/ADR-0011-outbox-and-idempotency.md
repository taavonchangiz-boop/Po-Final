# ADR-0011: Publishing = transactional outbox + idempotency keys + delivery state machine
Status: accepted | Owner: Backend Architect
## Why
Contract §21-23, §125. Reference had cron/heartbeat/AJAX racing the same send pipeline with duplicate sends and no atomic claim.
## Consequences
- post/delivery state + outbox committed atomically; relay enqueues to BullMQ with jobId = deliveryId; delivery transitions guarded (PENDING→PROCESSING→SENT/RETRYING/FAILED/CANCELLED) with bounded classified retries.
