# ADR-0009: Bots = external provisioning + in-dashboard connect/verify/manage
Status: accepted | Owner: Principal Architect
## Why
Contract §18. No provider API allows creating a bot account server-side; the reference UX hid this and confused users.
## Consequences
- Dashboard guides per-platform token acquisition (BotFather/Bale/Rubika), then connects, verifies via getMe, and manages commands/responses/workflows/AI centrally.
