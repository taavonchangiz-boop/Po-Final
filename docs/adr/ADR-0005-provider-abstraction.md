# ADR-0005: Channel providers = capability-declaring adapters (Telegram, Bale, Rubika first-class)
Status: accepted | Owner: Principal Architect
## Why
Contract §15-16. Rubika was absent in both reference systems; the new product implements it as a first-class adapter. Bale reuses the Telegram Bot API protocol (tapi.bale.ai) with explicit per-capability deltas (e.g., deleteMessage unsupported).
## Alternatives rejected
- Generic "bot-api" adapter with URL override only (hides provider deltas; audit showed this caused broken HTML parse_mode and unauthenticated Bale webhooks).
## Consequences
- Each adapter maps provider errors to internal codes + safe Persian messages; capability map drives UI affordances (§184-185).
- No capability emulation: unsupported operations return NOT_SUPPORTED and are hidden/disabled in UI.
