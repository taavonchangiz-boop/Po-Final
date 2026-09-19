# ADR-0008: Analytics = append-only events + daily aggregate read model
Status: accepted | Owner: Backend Architect
## Why
Contract §24-25, §99. Reference scattered counters in controllers; dashboards did full scans / fake charts.
## Consequences
- events table (no credentials/PII payloads) + event_daily aggregates; dashboards read aggregates; timeline uses cursor pagination; retention sweeps bound growth (§106).
