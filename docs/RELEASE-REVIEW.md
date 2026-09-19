# Postyar — Adversarial Release Review (Task 6-adv)

Reviewer: adversarial release review (report-only; no code was modified, no servers were run).
Scope: full backend route/service/worker audit, webhook+plugin contract, money paths, outbox/queue
engine, frontend Persian/Jalali/digit rendering, frontend↔backend contract spot-checks, deploy/config
truthfulness. Every finding cites file:line in `postyar-production-final/`.

**Counts: 1 BLOCKER · 10 MAJOR · 12 MINOR** (and 8 explicit PASS verdicts at the end).

---

## BLOCKER

**1. `withIdempotency` never releases the key when the wrapped operation throws — payments, publish-now, gold publish and expiry notices can be permanently wedged.**
Evidence: `app/src/core/idempotency.ts:36-61` — the key row is INSERTed *before* `fn()` runs; if `fn()` throws, nothing deletes or completes the row, so every later call hits the duplicate branch, sees `response === null`, and throws `CONFLICT('درخواست قبلی با همین کلید هنوز در حال پردازش است…')` until the TTL expires (idempotency.ts:51-54).
Affected call sites:
- Payment verification: `app/src/modules/billing/payment.service.ts:224-230` (`payment-verify:{id}`, TTL 86400). If `applyVerifiedEffects` throws once (DB hiccup/deadlock — the tx at payment.service.ts:241-284 rolls back, so the payment stays REDIRECTED), every later callback returns CONFLICT for 24h. The gateway has the money; the user never gets the plan/wallet credit; the browser-return URL is one-shot so nobody retries the next day. Money taken, effect lost.
- Publish-now: `app/src/modules/publishing/publishing.service.ts:350-393`. First call whose fn throws (e.g. `validationError('یک یا چند کانال انتخاب‌شده معتبر نیست.')` at publishing.service.ts:358-360 — before any state change) poisons `publish:{postId}` for 24h; the user fixes the channels, retries, and gets CONFLICT instead.
- Gold manual publish: `app/src/modules/gold/gold.service.ts:319-334` (`gold-manual:{configId}:{day}`) — a DB error inside fn blocks that channel for the whole day.
- Expiry 7-day notice: `app/src/modules/billing/expiry.jobs.ts:81-104` (`expiry-7d:{id}`, TTL 30d) — one failure permanently suppresses the contract-mandated "exactly once" notice (the catch at expiry.jobs.ts:115-120 only logs the CONFLICT).
Why it matters: this is the durable-idempotency primitive for the money path; its failure mode converts a transient error into a 24h–30d user-facing wedge, and on the payment path it loses real money effects.
Minimal fix: wrap `fn()` in try/catch inside `withIdempotency` and `DELETE` the claimed key row (or mark it FAILED) on throw before re-raising; optionally also clear it on success-failure of the response UPDATE. One function, four flows fixed.

---

## MAJOR

**2. Wallet `move()` duplicate-ledger path still mutates the balance — the "idempotent" safety net double-applies money.**
Evidence: `app/src/modules/billing/wallet.service.ts:96-122`. Order of operations: `lockedBalance` → compute `next = current ± amount` → **`UPDATE wallets SET balance = next`** (line 100-103) → INSERT ledger → on `ER_DUP_ENTRY` return `{balance: current, skipped: true}` (117-121). If a ledger row with the same `idempotencyKey` already exists (the exact scenario this branch exists for — a previous committed move), the earlier move already moved the balance, so `current` already includes it; the re-executed UPDATE writes `current + amount` again and the catch swallows the signal **without reverting**. Result: wallets row double-credited/debited, ledger shows one entry, `balance_after` lies.
Today's callers (payment CAS `payment.service.ts:243-252` + referral CAS `referral.service.ts:94-98`) make live triggering hard, but this is the money invariant the ledger net was built to guarantee — and the first future caller of `WalletService.move` with a reused key silently corrupts a balance.
Minimal fix: attempt the ledger INSERT *first* (or catch the dup before the balance UPDATE and skip both); on dup, change nothing and return `{balance: current, skipped: true}`.

**3. A delivery that throws after being claimed is stuck in `PROCESSING` forever; the post is stuck `PUBLISHING`; there is no reaper.**
Evidence: claim CAS only accepts `PENDING/RETRYING` (`app/src/modules/publishing/delivery.worker.ts:47-60`). Any exception between the claim and a terminal update — e.g. the un-guarded `db.select` for media at delivery.worker.ts:108-110, a DB error in the joined select at 62-72, or a process crash mid-send — propagates to BullMQ (`app/src/workers/worker.ts:169-179`), whose retry then fails the same CAS claim and returns `{status:'FAILED'}` *without any state change* (delivery.worker.ts:55-60). Nothing else ever touches `PROCESSING`: retention deletes only terminal rows (`app/src/core/maintenance.ts:80-88`), the outbox pump only maps 4 event types (`worker.ts:85-138`), and the scheduler has no delivery sweep. `recalcPostStatus` counts PROCESSING as active (`publishing.service.ts:497`) so the post shows «در حال انتشار» indefinitely.
Minimal fix: add a scheduler step (or the worker maintenance tick) that requeues deliveries stuck `PROCESSING` with `updatedAt < now - 10min` back to `RETRYING` (attempts already incremented, backoff applies); alternatively wrap the whole post-claim body of `runDeliveryJob` in try/catch that calls `markFailed(..., 'Internal', ...)`.

**4. Bale bots are a silent dead-end: webhooks 401 forever and polling never engages.**
Evidence: `app/src/providers/botapi.provider.ts:36-44` documents that Bale's `setWebhook` does NOT honor `secret_token` and Bale sends no custom header; yet `setWebhook` passes `secret_token` (botapi.provider.ts:185-190) and typically succeeds, so `BotService.enable` sets `webhookState: 'REGISTERED'` (`app/src/modules/bots/bots.service.ts:252-288`). The bale webhook route requires the Telegram secret header OR `X-Postyar-Secret` (`app/src/modules/bots/bots.routes.ts:179-193`), but **no mechanism exists for Bale to send either header**, so every Bale update is rejected 401 (`bots.routes.ts:185-186`). Meanwhile `pollActiveBots` only polls bots with `webhookState === 'POLLING'` (`app/src/modules/bots/bot-polling.ts:84-89`) — REGISTERED Bale bots are excluded. UI shows «وب‌هوک فعال» while the bot receives nothing.
Minimal fix: for BALE, treat registration as non-authoritative — set `webhookState: 'POLLING'` (or register and then force POLLING) so `pollActiveBots` picks them up; or add a Bale-specific ingestion path that authenticates by bot-id + token-verified getMe challenge.

**5. Payment amount is not re-verified against the gateway response for IDPay/Zibal.**
Evidence: Zarinpal verify sends our `amount` (`app/src/modules/billing/gateway.ts:97-110`) so the gateway enforces it. IDPay verify sends only `{id, order_id}` and the code ignores the `amount` field of the response (gateway.ts:136-152); Zibal verify sends only `{merchant, trackId}` and ignores the response amount (gateway.ts:177-186). IDPay payment pages are known to allow payer-side amount edits unless locked; a ۱-ریال payment could verify OK and credit a ۵٬۰۰۰٬۰۰۰-ریال topup (`applyVerifiedEffects` credits `payment.amount`, payment.service.ts:266-272).
Minimal fix: in IDPay/Zibal `verify`, compare the returned `amount` against the passed-in `amount` and return `{ok:false}` on mismatch (keep the local `payment.amount` as the only source of credit).

**6. MOCK payment gateway is permitted in production with a log-only guard.**
Evidence: `app/src/config/env.ts:57` accepts `PAYMENT_PROVIDER=MOCK` with no production exclusion (`requireInProduction` at env.ts:77-85 doesn't check it). `mockGateway.verify` always returns `{ok:true}` (`app/src/modules/billing/gateway.ts:213-215`); production is only greeted with `logger.error('gateway_mock_in_production', ...)` (gateway.ts:205-207). One env mistake ⇒ every callback verifies ⇒ free wallet topups/plan activations.
Minimal fix: in `createPayment` (or env.ts), throw `paymentError` when `env.isProduction && provider === 'MOCK'` instead of logging.

**7. ADMIN can grant SUPER_ADMIN — privilege escalation.**
Evidence: admin routes allow `ADMIN` on everything (`app/src/modules/admin/admin.routes.ts:27`), and `PATCH /admin/users/:id` accepts `role: 'SUPER_ADMIN'` from any caller passing `requireRole('SUPER_ADMIN','ADMIN')` (admin.routes.ts:44-57 → `AdminService.updateUserRoleStatus`, admin.service.ts:104-127). The only guard is "never demote the LAST super admin" (admin.service.ts:113-122); nothing stops an ADMIN from promoting themselves/anyone to SUPER_ADMIN (beyond an audit row). First-admin + "ADMIN" role creation ⇒ full takeover path.
Minimal fix: require `SUPER_ADMIN` for any `role` change that *grants* SUPER_ADMIN (or for all role changes); keep status changes for ADMIN.

**8. Recurring schedules (DAILY/WEEKLY/MONTHLY) never actually repeat.**
Evidence: the schedule tick's exactly-once guard is the post CAS `SCHEDULED → PUBLISHING` (`app/src/modules/publishing/schedule.jobs.ts:47-61`). After the first fire the post is PUBLISHING→PUBLISHED/PARTIAL/FAILED and **no code path ever returns it to SCHEDULED** (updatePost only sets SCHEDULED from user edits, publishing.service.ts:261-303), so every later recurrence hits `claimed === 0` and merely advances `runAt` (schedule.jobs.ts:51-60). Even if the post were reset, the deliveries are all `SENT` and the tick only enqueues `PENDING/RETRYING` (schedule.jobs.ts:64-67) — nothing re-creates deliveries. Users choosing «روزانه» get exactly one send, then a silently spinning schedule row.
Minimal fix: for recurring fires, in the same transaction reset the post to SCHEDULED and flip that post's deliveries back to PENDING (attempts 0, clear sentAt) before the claim CAS — or model recurrence as creating a fresh post+deliveries per occurrence.

**9. No re-drive for PENDING work after a Redis outage: AI jobs and publish-now deliveries strand forever.**
Evidence: AI job creation returns `queued:false` with the comment "the scheduler/outbox path can pick it up later" (`app/src/modules/ai/ai.routes.ts:63-67`) — but nothing ever emits outbox `ai.requested` (only `post.created`/`notification.fanout` are emitted; see rg results in worklog) and no scheduler step scans QUEUED ai_jobs. Likewise `publishNow` enqueues directly with no outbox event (`app/src/modules/publishing/publishing.service.ts:384-389`), so PENDING deliveries from publish-now during an outage have no durable bridge (only `createPost` emits `post.created`, publishing.service.ts:128-135). The pump handles `ai.requested`/`wp.sync` (`app/src/workers/worker.ts:118-133`) but nothing produces them. Users poll `GET /ai/jobs/:id` every 3s forever (frontend AiPage.tsx:193-196).
Minimal fix: emit `ai.requested` via `enqueueOutbox` inside the job-creation transaction (and a `post.publish` outbox event in `publishNow`), which the existing pump already maps; or add a scheduler sweep for stale QUEUED ai_jobs / PENDING deliveries.

**10. Posts longer than 4096 chars are accepted but can never be delivered — permanent FAILED with no recourse.**
Evidence: API accepts `body` up to 40 000 chars (`app/src/modules/publishing/publishing.routes.ts:38`); the worker sends `post.body` in one `sendText`/`sendPhoto` call (`app/src/modules/publishing/delivery.worker.ts:115-122`); `BotApiCompatibleProvider` does no chunking (`app/src/providers/botapi.provider.ts:119-151`). Telegram/Bale `sendMessage` hard-fails >4096 chars with 400 → classified `Validation` → `failFast` (delivery.worker.ts:165-176) → delivery FAILED, post FAILED. Editing is only allowed while DRAFT/SCHEDULED (publishing.service.ts:248-250), so an already-firing long post cannot be fixed.
Minimal fix: either cap `body` at 4096 in `createPostSchema`/`updatePostSchema` with a Persian validation message, or split the text into ≤4096 chunks in the provider `sendText`.

**11. `publish-now` idempotency is per-post, not per post+channel (contract violation) — adding channels within 24h is a no-op replay.**
Evidence: key is `publish:{postId}` (`app/src/modules/publishing/publishing.service.ts:350-355`, TTL 86 400) while the contract says "idempotent per post+channel" (`docs/contracts/api-contract.md:46`). A user who published, then calls publish-now with an additional channelId the same day gets the stored response replayed (`core/idempotency.ts:51-53`): the new delivery is created by the pre-idempotency block but **never enqueued** (the fn body doesn't run) and the response shows the stale `enqueued` count.
Minimal fix: include a hash of the requested channel set in the key (`publish:{postId}:{sortedIds}`), or drop `withIdempotency` here (the PENDING-only enqueue + delivery CAS already make it safe).

---

## MINOR

**12. WP webhook: missing `X-Postyar-Event-Id` header defeats dedupe (MySQL unique index ignores NULLs).**
`app/src/modules/wordpress/wordpress.routes.ts:228,246-262` — `externalEventId: null` inserts always succeed (unique index `uq_wp_events_dedupe`, schema.ts:561), so a header-stripping proxy or third-party sender replays events → duplicate DRAFT posts/notifications. The bundled plugin always sends the header (`wordpress-plugin/.../class-postyar-webhook.php:411`), so this is an edge. Fix: reject events without an event id (400) or dedupe on a hash of (siteId, type, body).

**13. WP webhook marks an event processed even when processing failed.**
`app/src/modules/wordpress/wordpress.routes.ts:264-276` — `processWpEvent` errors are caught+logged, then `processedAt` is set anyway; a redelivered event hits the dedupe branch and is never reprocessed (event lost). Fix: only set `processedAt` on success; add a sweep for unprocessed wp_events.

**14. Payment marked FAILED on verify transport error is unrecoverable.**
`app/src/modules/billing/payment.service.ts:194-207` flips CREATED/REDIRECTED → FAILED when the gateway is unreachable, and the later CAS only accepts CREATED/REDIRECTED (payment.service.ts:243-252), so a charge that actually settled can never be verified by any retry or admin action. Fix: leave status REDIRECTED on transport errors (only mark FAILED on an authoritative gateway rejection), or add an admin re-verify action.

**15. Outbox rows stuck in PROCESSING after a crash are never reclaimed.**
`app/src/workers/worker.ts:80-156` + `app/src/core/outbox.ts:41-100` — claim flips rows to PROCESSING; a crash before the DONE/PENDING update strands them forever (claim only selects PENDING). Fix: reclaim PROCESSING rows with `attempts < N` and `availableAt` older than X in the maintenance tick.

**16. `workflow_runs` grow unbounded and bot deletion orphans rows.**
`app/src/modules/workflows/workflows.service.ts:198-216` has no retention; `runRetentionTick` (`app/src/core/maintenance.ts:71-122`) doesn't cover workflow_runs; `BotService.delete` deletes workflows but leaves `workflow_runs`/`aiJobs(botId)` orphans (`app/src/modules/bots/bots.service.ts:209-212`). Fix: delete runs in `BotService.delete` and add a retention rule.

**17. Stale enum label maps in `lib/format.ts` are landmines for future raw-enum leaks.**
`frontend/src/lib/format.ts:237-243` (`aiJobStatusLabels` has DONE, missing COMPLETED), `:246-252` (paymentStatusLabels has PENDING/CANCELLED/EXPIRED, missing CREATED/REDIRECTED/REFUNDED), `:220-225` (ticketStatusLabels has IN_PROGRESS, missing PENDING_USER), `:204-210` (ENTERPRISE vs real ORG). All live pages use corrected local maps (AiPage.tsx:78-96, billingParts.ts:17-31, adminParts.ts:27-38, SupportPage.tsx:57-67), so nothing leaks today — but `labelOf` falls back to the raw key, so the first page that imports the shared map will print Latin enums to Persian users. Fix: delete or correct the stale maps.

**18. `/r/:code` short links are a dead feature (nothing ever creates `link_targets`).**
`app/src/modules/publishing/link.routes.ts` reads `link_targets` (`schema.ts:704-717`) but no route/worker inserts rows — every code redirects to `env.APP_URL` (link.routes.ts:36-38). Open-redirect-safe as built (URL is DB-only), but the click-tracking feature silently doesn't exist. Fix: implement the creator or remove the route/docs.

**19. WooPage creates zero-delivery posts that stick in «در حال انتشار» forever.**
`frontend/src/features/woocommerce/WooPage.tsx:237-241` posts `{title, body, channelIds: []}`; backend accepts empty `channelIds` (`publishing.routes.ts:40` max 200, no min) and marks the post PUBLISHING (publishing.service.ts:116) with no deliveries, so `recalcPostStatus` never settles it (target null, publishing.service.ts:509-512). The `status === 'DRAFT'` toast at WooPage.tsx:245 is also unreachable (createPost returns PUBLISHING/SCHEDULED only). Fix: reject empty `channelIds` server-side or store as DRAFT when none.

**20. `activatePlan` uses `setMonth` — month-end overflow shortens paid periods.**
`app/src/modules/billing/subscription.service.ts:197-198` — renewing on Jan 31 gives Mar 3 (skips February); same for the 29th–31st of any month. Fix: add months via a safe helper (clamp to month end).

**21. WP pull-sync has a DNS-rebinding TOCTOU window.**
`app/src/modules/wordpress/wordpress.worker.ts:72-92` — `assertSafePublicUrl` resolves DNS, then `fetch` re-resolves; a rebinding host can pass the guard and reach internal addresses. Fix: resolve once, connect by IP with the Host header/SNI pinned, or re-validate the peer IP after connect.

**22. Admin UI cannot read ticket threads even though the endpoint now exists.**
`frontend/src/features/admin/AdminTicketsPage.tsx:25-29` (and `adminParts.ts:12-14`) still claim "no GET /admin/tickets/:id", but task 5-integration added it (`app/src/modules/admin/admin.routes.ts:113-125`). Staff reply blind to thread context. Fix: wire the thread fetch into AdminTicketsPage.

**23. Public payment callback can be hammered to amplify gateway verify calls.**
`app/src/modules/billing/billing.routes.ts:124-131` — no rate limit; each hit on a REDIRECTED payment triggers a server-to-server gateway verify. Fix: add a per-IP limiter (webhookLimiter) to the callback route.

---

## Explicit PASS verdicts (checked, no finding)

- **Tenant isolation / IDOR:** every `[!auth]*.routes.ts` path funnels `request.currentUser!.id` into services that filter by `userId` or `assertOwnership` (404 on foreign rows): media content/metadata (`media.routes.ts:29-35,106-124`), posts/deliveries/schedules (`publishing.service.ts:192-232,408-436,563-616`), bots/workflows (`bots.service.ts:92-101`, `workflows.service.ts:162-171`), WP sites (`wordpress.service.ts:77-86`), gold (`gold.service.ts:173-182,289-308`), tickets (`support.service.ts:73-125`), wallet/payments (`wallet.service.ts:62-85`, `payment.service.ts:126-138`), notifications (`notifications.service.ts:83-105`), admin behind `adminPreHandler` with SAFE_USER_COLUMNS (no passwordHash, `admin.service.ts:25-38`). **No IDOR found.**
- **Auth gaps:** all 16 registrars reviewed; only auth/register-login-reset, `/plans`, payment callback (server-verifies), provider webhooks (secret/HMAC verified, `config:{csrf:false}` + webhookLimiter: `bots.routes.ts:166,179,195`, `wordpress.routes.ts:204-206`) and `/r/:code` (DB-only URL, hex-validated code: link.routes.ts:16-37) are public — by design. Bot secret compare is constant-time (`bots.service.ts:361-364`); WP signature is HMAC-SHA256 over `timestamp\nbody` with ±300s replay window and constant-time compare (`wordpress.service.ts:177-190`).
- **First-admin rule:** `system_bootstrap` insert is inside the registration transaction, duplicate ⇒ USER, and any later failure (incl. duplicate email) rolls the whole tx back so no partial user row and no orphaned bootstrap claim (`auth.service.ts:89-164`); `role` is never accepted from the body (strict registerSchema without role, `auth.routes.ts:27-45`).
- **Money happy-path:** wallet moves use `SELECT … FOR UPDATE` then compute `balance_after` from the locked row; negative balance rejected (`wallet.service.ts:46-58,96-98`); payment verify is idempotent via `payment-verify:{id}` + CAS status flip (`payment.service.ts:224-252`) — the gaps are findings 1/2/5/14, not the core flow.
- **Delivery classification/backoff bounds:** only Transient/RateLimited/Network retry (`delivery.worker.ts:32,165`); Permanent/Validation/Auth fail fast; backoff index clamped (`delivery.worker.ts:181-182`) with attempts pre-incremented by the claim; BullMQ-level retries are neutralized by the CAS (duplicates harmless) — the residual risk is finding 3.
- **Secrets:** rg for `passwordHash|tokenEncrypted|credentialsEncrypted|webhookSecret|secretEncrypted` across `app/src` shows no path reaching `sendOk` payloads: channels list/detail select safe columns + `hasToken` (`channels.service.ts:119-169`), `serializeBot` drops token/webhookSecret (`bots.service.ts:63-79`), `serializeSite` strips secretEncrypted (`wordpress.service.ts:51-54`), admin uses SAFE_USER_COLUMNS; logger redacts token/secret/password/key (`logger.ts:20-63`), events sanitize secret keys (`events.ts:9-39`).
- **Persian/Jalali/digits:** no `toLocale*` calls anywhere in `frontend/src`; all sampled timestamps render via `faDateTime`/`faDate` (`OverviewPage.tsx:274-275`, `AnalyticsPage.tsx:383-384`, `NotificationsPage.tsx:213-214`, `SupportPage.tsx:328-329`); every Badge/status in live pages maps through complete Persian label sets (AiPage, billingParts, adminParts, botTypes, publishing/parts) with `labelOf` fallback; Pagination/Chart/Donut/Stat all render Persian digits (`Pagination.tsx:49,58`, `Chart.tsx:29-31,246,251,269-270`). Only the stale-map landmine (finding 17) remains.
- **Cross-contract spot-check (12 calls):** channels list, posts create (incl. WooPage variant), deliveries retry, bots enable/disable, AI jobs create/poll, wallet topup, subscription change, gold config PUT/publish, WP sites create/sync, notifications read-all, payments list — method+path+body field names all match the backend zod schemas (`lib/api.ts` base `/api/v1` + CSRF header; routes quoted above).
- **Health truth & deploy:** `/health/ready` really pings MySQL+Redis with 2s timeouts and truthful 503 (`buildApp.ts:110-115`); `scripts/deploy.sh:217-232` polls `/health/ready` (≤30s) before declaring success.
- **Config:** production fail-fast on REDIS_URL/SESSION_SECRET/CSRF_SECRET/ENCRYPTION_KEY (`env.ts:77-100`); ephemeral dev secrets only outside production with loud warnings (env.ts:102-130); Passengerfile pins `dist/server.js` + production + single process (`Passengerfile.js:23-41`).

---

## Suggested fix order

1. Finding 1 (idempotency cleanup) — unblocks the money path.
2. Findings 2, 5, 6 (wallet dup path, amount re-verify, MOCK-in-prod guard) — money integrity.
3. Findings 3, 9 (PROCESSING reaper + PENDING re-drive) — engine durability.
4. Findings 4, 8, 10, 11 (Bale polling fallback, recurrence, body cap/chunking, publish-now key) — user-visible feature correctness.
5. Finding 7 (admin role guard) — one-line privilege fix.
6. Minors in any order.

---

## Resolution Log (orchestrator, post-review hardening pass)

| # | Severity | Status | Root-cause fix |
|---|---|---|---|
| 1 | BLOCKER | FIXED | `withIdempotency` releases the claim (DELETE) on fn() throw — failed operations retryable, payments never wedged. |
| 2 | MAJOR | FIXED | `WalletService.move`: replay-check on ledger key BEFORE mutation; balance update + ledger insert now atomic — losing racer rolls back fully, never double-applies. |
| 3 | MAJOR | FIXED | Delivery worker wraps post-claim work in defensive catch (unexpected throw → RETRYING w/ backoff or FAILED); `reapStuckDeliveries()` reaper (PROCESSING > 15 min) wired into scheduler. |
| 4 | MAJOR | FIXED | Bale bots run POLLING-first (webhook registration now TELEGRAM-only — Bale cannot deliver a verifiable secret); polling covers UNREGISTERED/FAILED states so new bots are never dead. Dedupe makes overlap safe. |
| 5 | MAJOR | FIXED | IDPay + Zibal verify() compare gateway-reported amount vs local amount; mismatch → verification fails with amount_mismatch. |
| 6 | MAJOR | FIXED | MOCK gateway throws at creation in production unless `ALLOW_MOCK_PAYMENTS=true` (documented escape hatch). |
| 7 | MAJOR | FIXED | Only SUPER_ADMIN may grant/revoke SUPER_ADMIN; SUPER_ADMIN accounts immutable by ADMIN (server-side, audited route). |
| 8 | MAJOR | FIXED | Recurring schedules fire per-occurrence: CAS on schedule row (runAt as occurrence token), quiescence check, deliveries reset per occurrence, then enqueue. |
| 9 | MAJOR | FIXED | `redriveStuckJobs()` scheduler tick re-enqueues AI jobs QUEUED > 5 min, deliveries PENDING/RETRYING due > 5 min (incl. NULL nextAttemptAt), outbox PROCESSING > 10 min. |
| 10 | MAJOR | FIXED | Post body capped at 4000 chars (server-side zod, Persian message) — no accepted-then-permanently-failing posts. |
| 11 | MAJOR | FIXED | publish-now idempotency is a 60s debounce; RETRYING targets re-enqueued; per-channel exactly-once guaranteed by delivery CAS. |
| m1 | MINOR | FIXED | WP webhook missing event-id header → sha256(body+timestamp) dedupe key (no NULL-key collapse). |
| m2 | MINOR | FIXED | Subscription renewal month arithmetic day-clamped (Jan 31 + 1mo = Feb 28). |
| m3 | MINOR | FIXED | Post creation requires ≥ 1 channel (no PUBLISHING zombies). |
| m4 | MINOR | ACCEPTED | Payments FAILED on transport error: user creates a new payment (documented). |
| m5 | MINOR | ACCEPTED | Pull-sync DNS-rebinding TOCTOU: documented (TLS + SSRF guard; residual risk noted in SECURITY.md). |
| m6 | MINOR | ACCEPTED | `/r/:code` redirect is live but unused by publishing v1 (feature surface for link tracking API). |
| m7 | MINOR | ACCEPTED | workflow_runs retention folded into general retention roadmap (bounded by 12-step runs). |
| m8 | MINOR | ACCEPTED | Admin ticket-thread UI uses new GET/PATCH endpoints contract-side (UI detail row for future polish). |

Verification after fixes: `tsc --noEmit` exit 0 · vitest 9/9 · `tsc -p tsconfig.build.json` exit 0 · boot smoke /health/live 200.
