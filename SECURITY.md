# Postyar — Security

Status: v1.0.0 · Engineering doc (product UI is Persian). Threat-model controls map 1:1 to implemented code in `postelrobbal/app/src/`.

## 1. Threat model → controls

| # | Threat | Control (where) |
|---|---|---|
| T1 | Credential stuffing / brute force | Argon2id hashes (`security/passwords.ts`), rate limits (login 10/15 min, register 5/h, reset 5/h), generic failure messages |
| T2 | Session theft / fixation | DB-backed sessions, sha256-hashed cookie token, rotation on login & password change, revocation tables, `SameSite=Lax` cookie, `HttpOnly` (ADR-0006) |
| T3 | CSRF on mutating requests | Double-submit: per-session `csrf_secret` + `x-csrf-token` header verified in `buildApp` for POST/PUT/PATCH/DELETE; webhooks/payment-callback exempted by design |
| T4 | Cross-tenant data access | Every service takes `tenantId` from the **session**, never from input; ownership checks before any read/write; permission matrix (`security/permissions.ts`) |
| T5 | Privilege escalation | Route-level `requirePermission('admin.*')`; roles SUPER_ADMIN/SUPPORT/USER; audited in `audit_logs` |
| T6 | Secret theft at rest | AES-256-GCM (`security/encryption.ts`) for bot tokens & provider secrets; only hash stored for webhooks/WordPress secrets; API responses expose masked values only (`****abcd`) |
| T7 | SSRF via user URLs (gold source, media/images) | `core/http.ts` SSRF guard: scheme allowlist, DNS-resolves-then-check (private/loopback/link-local/metadata ranges blocked), redirect re-validation |
| T8 | Webhook spoofing / replay | Bot webhooks: per-bot secret in URL + dedup `uq_bot_events_dedup`; WordPress: `x-postyar-site-key` + `x-postyar-secret`, server stores only SHA-256, timing-safe compare, 60 req/min |
| T9 | Malicious uploads | ≤8 MB service cap (10 MB stream cap), MIME allowlist + magic-byte sniffing, private storage, 15-min signed access tokens, path-traversal-safe ULID filenames |
| T10 | XSS / clickjacking | Helmet CSP (`default-src 'self'`), `frame-ancestors 'none'`, HSTS in production; React escaping in SPA |
| T11 | DoS via oversized payloads | `bodyLimit` 2 MB, multipart caps, pagination caps (pageSize ≤ 100), bounded workflow interpreter (≤20 steps/60 s) |
| T12 | Injection | Drizzle parameterized SQL everywhere; zod validation on every boundary |
| T13 | Supply-chain / repo leaks | Secret scan in `postelrobbal/scripts/release-check.sh` + CI; `.env` git-ignored; packaging excludes `.env`, keys, DB files |

## 2. Auth design

- **Passwords**: Argon2id (`argon2` package), policy ≥8 chars with letters+digits (`WEAK_PASSWORD` otherwise); change-password re-issues the session + CSRF secret and revokes all other sessions.
- **Sessions (ADR-0006)**: opaque random token in the `py_session` cookie; only `sha256(token)` is stored (`sessions.token_hash` UNIQUE) with a per-session `csrf_secret`, expiry, and revocation; login rotates (revokes prior sessions). `GET /auth/me` returns a fresh CSRF token.
- **CSRF**: `issueCsrfToken(csrfSecret)` (HMAC-style derived token) must be sent as `x-csrf-token` on every mutating API call; invalid → `CSRF_INVALID` (403).
- **Password reset**: email flow, single-use hashed tokens with expiry, enumeration-safe generic responses.
- **Account deletion**: anonymizes the user row (email/mobile replaced, name wiped, hash invalidated), suspends, revokes sessions — transactional.

## 3. Tenant isolation model

`tenant_id = users.id`. Every tenant-owned table carries `tenant_id`, and every service call derives it exclusively from `req.user` — client-supplied tenant IDs are never trusted. Cross-tenant collisions are prevented structurally:

- `channel_registry` PK (`platform`,`channel_ref`) is the global claim map — a second tenant claiming the same channel gets `CONFLICT` («این کانال قبلاً توسط کاربر دیگری ثبت شده است»); release requires admin action.
- Posts/targets, media, workflows, AI jobs, wallet/points ledgers, tickets, notifications are always queried `WHERE tenant_id = session tenant`.
- Admin/support endpoints require `admin.access` / `support.tickets.any` permissions; SUPPORT can read any ticket but nothing else cross-tenant.

## 4. Encryption at rest

- Key: `ENCRYPTION_KEY` env var — exactly **64 hex chars** (32 bytes), used as the AES-256-GCM key (per-object random IV; auth tag stored alongside).
- Encrypted: bot tokens (`bots.token_encrypted`), provider API keys. Hashed (SHA-256), never encrypted: session tokens, reset tokens, media access tokens, WordPress secrets, bot webhook secrets.
- Rotation: rotating `ENCRYPTION_KEY` makes stored provider tokens undecryptable — tenants must re-enter bot tokens; plan a maintenance window (see OPERATIONS.md).

## 5. Webhook security

- **Bot webhooks** (`POST /api/v1/webhooks/bots/:botId?s=<secret>`): secret generated at bot connect (24-char random, 64-char column), verified timing-safely; invalid/unknown → always `{success:true}` (no oracle); dedup via `bot_events.dedup_hash` UNIQUE; rate limit 600/min; CSRF exempt by URL prefix (provider-to-server).
- **WordPress** (`POST /api/v1/webhooks/wordpress`): headers `x-postyar-site-key` + `x-postyar-secret`; server verifies `sha256(header) == secret_hash` timing-safely; secret shown **once** on connect/rotate; 60 req/min; feature-gated by plan (`woocommerce`).
- **Payment callback** (`GET /api/v1/payments/callback`): ZarinPal server-side verify before marking `VERIFIED`; idempotent by UNIQUE (`gateway`,`authority`); always 302s to the dashboard, never leaks JSON errors.

## 6. SSRF guard

Any user-supplied URL (gold `sourceUrl`, product `image_url`, media fetch) goes through `core/http.ts`: http/https only, DNS resolution checked **before** connect against private/loopback/link-local/CGN/metadata ranges, and redirects are re-validated per hop. The gold config additionally validates the URL at save time (`assertSafeUrl`).

## 7. Rate limits

| Scope | Limit |
|---|---|
| Register / password-reset request | 5 / hour / IP |
| Password-reset confirm | 10 / hour / IP |
| Login | 10 / 15 min |
| Bot webhook ingest | 600 / min |
| WordPress webhook | 60 / min |
| Workflow interpreter (per run) | ≤20 steps, 60 s, ≤2 AI calls, ≤10 outbound messages |
| Bot auto-reply spam guard | 20 replies / chat / hour (in-memory, bounded) |
| AI quota | per-plan `ai_monthly` (0 = unlimited), atomic upsert counter |
| SMS (provider policy, seed) | 3 / hour / phone |

`@fastify/rate-limit` runs in-memory (single-API-process contract); a 429 returns the standard error contract with `RATE_LIMITED`.

## 8. Secrets policy (§93)

- **Never commit** real `.env` — the repo carries only `postelrobbal/config/.env.example` with placeholders; CI and `release-check.sh` fail on committed secrets/keys.
- On the server: `postelrobbal/config/.env`, `chmod 600`, owned by the cPanel user; readable by the API process only.
- Generation: `SESSION_SECRET`/`CSRF_SECRET` ≥32 random chars (`openssl rand -base64 48`); `ENCRYPTION_KEY` = `openssl rand -hex 32`.
- Scope discipline: one key set per environment; staging ≠ production; bot tokens and AI keys belong to tenants/global settings, not to code.
- Leaked-credential handling: rotate the affected secret, revoke sessions if `SESSION_SECRET` rotated, audit `audit_logs` for the exposure window, record the incident.

## 9. Reporting (security contact)

- **Contact (placeholder — set before public launch):** `security@postyar.example` · PGP: *to be published*
- Please include reproduction steps and affected URLs; do not test against production tenants.
- Response target: acknowledge ≤ 2 business days; fix-or-mitigate per severity; post-incident note in RELEASE-NOTES if user-visible.
