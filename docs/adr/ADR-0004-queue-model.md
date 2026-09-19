# ADR-0004: Queues = BullMQ on external Redis
Status: accepted | Owner: Principal Architect
## Why
Contract §53: Redis is external infrastructure; BullMQ is the queue engine. Durable delivery/bot/AI/notification processing with bounded concurrency.
## Alternatives rejected
- DB-backed queue via polling only (no delayed jobs/backoff ergonomics; higher DB pressure).
- RabbitMQ (extra infra unavailable on cPanel).
## Consequences
- Worker + scheduler are separate single processes; scheduler uses Redis lock and a tick-and-exit model (§126-127).
- Job retention bounded (completed 24h / failed 7d) to keep Redis memory finite (§108).
