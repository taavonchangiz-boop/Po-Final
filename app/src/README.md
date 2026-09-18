# Postyar API — backend foundation

Fastify 5 + TypeScript (strict, NodeNext, ES2022) + Drizzle ORM on MySQL/MariaDB,
BullMQ on Redis. No Next.js. Health: `/health/live`, `/health/ready`, `/health`.

## Layout

- `src/config/env.ts` — zod-validated environment (fails fast in production)
- `src/core/` — errors, logger, crypto (AES-256-GCM), http (SSRF guard), envelope, events, idempotency, outbox
- `src/db/` — drizzle client, canonical schema (do not edit), migrate runner, seed
- `src/security/` — sessions, CSRF double-submit, rate limits, tenant guards, redis
- `src/queue/` — BullMQ queues: deliveries, ai-jobs, wp-sync, notifications, maintenance
- `src/app/buildApp.ts` — fastify factory (plugins, health, error handler)
- `src/server.ts` — entry with graceful shutdown (SIGTERM/SIGINT)

## Commands

```bash
bun run typecheck      # tsc --noEmit
bun run test           # vitest (pure unit tests, no DB/Redis needed)
bun run build          # emits dist/ (tsconfig.build.json)
bun run db:migrate     # applies ../database/migrations/*.sql (tracked in __postyar_migrations)
bun run db:seed        # idempotent seed: plans + settings defaults
bun run dev            # tsx watch src/server.ts (do not run on shared infra)
```

## Environment variables

Required: `DATABASE_URL` (mysql://...).

Production additionally requires: `REDIS_URL`, `SESSION_SECRET` (≥32 chars),
`CSRF_SECRET` (≥32 chars), `ENCRYPTION_KEY` (exactly 32 chars or 64 hex).
In development/test missing secrets are generated ephemerally with a loud
warning — insecure by design, never use outside local dev.

Optional: `PORT` (default 3001), `APP_URL`, `API_URL`, `LOG_LEVEL`,
`STORAGE_DIR` (default `../storage` relative to app root), `SEED_TOKEN`,
mail (`MAIL_*`), SMS (`SMS_*`), provider fallback tokens (`TELEGRAM_BOT_TOKEN`,
`BALE_BOT_TOKEN`, `RUBIKA_BOT_TOKEN`), AI keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`,
`DEEPSEEK_API_KEY`, `CLAUDE_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`),
payment (`PAYMENT_PROVIDER`, `PAYMENT_MERCHANT_ID`, `PAYMENT_API_KEY`).

Load them via `node --env-file=.env` / `tsx --env-file=.env` or the process
environment (no dotenv dependency).

## Notes for module authors

- Relative imports only (NodeNext) — e.g. `../db/schema.js`.
- Envelope: use `reply.sendOk(data)` / `reply.sendCreated(data)` decorations.
- Errors: throw `AppError` factories from `core/errors.js`; the handler renders
  the contract envelope with Persian messages.
- Mutating routes require the `X-CSRF-Token` header matching the `py_csrf`
  cookie; public webhooks must set route `config: { csrf: false }`.
- Guard routes with `requireAuth`, `requireRole(...)`, `assertOwnership(...)`.
- Route rate limits: spread presets `authLimiter | aiLimiter | publishLimiter |
  webhookLimiter` into route options.
- Queue writes from services: persist state + `enqueueOutbox(tx, ...)` in one
  transaction; the outbox pump enqueues via `enqueue()` (never throws).
