# Postyar API Contract — v1

Base namespace: `/api/v1`. Health: `/health`, `/health/live`, `/health/ready` (no namespace).
All bodies are JSON unless stated. Cookies: `py_session` (HttpOnly, SameSite=Lax, Secure in production).
CSRF: double-submit — non-GET requests require header `X-CSRF-Token` matching the `py_csrf` cookie.

## Envelope

Success: `{ "success": true, "data": ... }` — Errors: `{ "success": false, "error": { "code": "<STABLE_CODE>", "message": "<safe Persian>", "requestId": "<id>" } }`

Stable error codes: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `PLAN_LIMIT`, `PAYMENT_ERROR`, `PROVIDER_ERROR`, `INTERNAL_ERROR`.

Pagination: offset lists accept `page` (1-based), `limit` (default 20, max 100) → `{ items, total, page, limit }`.
Cursor lists accept `cursor` (event/delivery id), `limit` → `{ items, nextCursor }`.

## Auth (public)
| Method | Path | Purpose |
|---|---|---|
| POST | /auth/register | Registration (نام، نام خانوادگی، موبایل، ایمیل، نام کسب‌وکار، نوع فعالیت، رمز عبور، تکرار، پذیرش قوانین، کد دعوت اختیاری). First user via DB-mutex becomes SUPER_ADMIN; others USER. |
| POST | /auth/login | Login; sets session cookie; rotates on privileged actions. |
| POST | /auth/logout | Revokes session server-side. |
| POST | /auth/password-reset | Request reset (generic response; token hashed, 30 min, single-use). |
| POST | /auth/password-reset/confirm | Confirm reset with token; revokes all sessions. |
| POST | /auth/change-password | Authenticated; revokes other sessions. |
| GET | /me | Current user + tenant summary (plan, unread notifications count). |

## Channels (`channels` module)
| Method | Path | Purpose |
|---|---|---|
| GET | /channels | List own channels (paginated, filter by provider/status). |
| POST | /channels | Create: `{provider, chatId, title, token}`. Token encrypted at rest; status PENDING until verify. Plan limit enforced. |
| GET | /channels/:id | Channel detail. |
| PATCH | /channels/:id | Update title / rotate bot token. |
| DELETE | /channels/:id | Disconnect (soft: status DISCONNECTED). |
| POST | /channels/:id/verify | Live provider health check (getMe/getChat) → ACTIVE/ERROR. |
| POST | /channels/:id/disable | Disconnect keeping history. |

## Posts & deliveries (`publishing` module)
| Method | Path | Purpose |
|---|---|---|
| GET | /posts | List (paginated; filter status, q). |
| POST | /posts | Create post `{title?, body, mediaId?, channelIds[], scheduleAt?}`. Creates deliveries in the same transaction; scheduleAt>now → SCHEDULED + schedule row, else enqueue now via outbox. |
| GET | /posts/:id | Post detail incl. per-channel delivery states. |
| PATCH | /posts/:id | Edit while DRAFT/SCHEDULED. |
| DELETE | /posts/:id | Cancel (dangling deliveries → CANCELLED). |
| POST | /posts/:id/publish-now | Immediately enqueue deliveries (idempotent per post+channel). |
| GET | /deliveries?postId= | Delivery list w/ state, attempts, safe error, retry-when. |
| POST | /deliveries/:id/retry | Retry a FAILED delivery (bounded by maxAttempts). |

## Schedules (`publishing` module)
| Method | Path | Purpose |
|---|---|---|
| GET | /schedules | List own schedules. |
| PATCH | /schedules/:id | Reschedule / pause / resume (Jalali UI converts; API takes ISO UTC). |
| DELETE | /schedules/:id | Cancel schedule. |

## Bots (`bots` module)
| Method | Path | Purpose |
|---|---|---|
| GET | /bots | List own bots. |
| POST | /bots | Register bot token (external provisioning guided in UI); verify getMe; plan limit enforced. |
| GET | /bots/:id | Detail incl. health, webhook state, commands, AI config. |
| PATCH | /bots/:id | Update title/commands/AI config/rotate token. |
| DELETE | /bots/:id | Delete bot (webhook de-registered where supported). |
| POST | /bots/:id/verify | Live getMe check. |
| POST | /bots/:id/enable, /bots/:id/disable | Toggle. |
| GET | /bots/:id/events | Recent bot events (paginated). |
| GET | /bots/:id/users | Bot users where provider data permits (privacy-minimal). |

## Workflows (`workflows` module)
| Method | Path | Purpose |
|---|---|---|
| GET | /workflows?botId= | List. |
| POST | /workflows | Create `{botId, name, definition}` (trigger + steps; server validates against capability registry + safety limits). |
| PATCH | /workflows/:id | Update / activate / deactivate. |
| DELETE | /workflows/:id | Delete. |
| GET | /workflows/:id/runs | Run history (paginated). |

## AI (`ai` module)
| Method | Path | Purpose |
|---|---|---|
| POST | /ai/jobs | Enqueue `{purpose, prompt, system?, provider?, model?, botId?}` → QUEUED (202). Quota enforced server-side. |
| GET | /ai/jobs | List own jobs. |
| GET | /ai/jobs/:id | Job status/output (poll). |
| GET | /ai/usage | Current month credits vs plan quota. |

## Gold (`gold` module)
| Method | Path | Purpose |
|---|---|---|
| GET | /gold/prices | Latest prices per asset (own tenant). |
| POST | /gold/prices | Manual price entry `{asset, price}`. |
| GET | /gold/configs | List gold publishing configs. |
| PUT | /gold/configs/:channelId | Upsert config (assets, frequency, timeOfDay, timezone, template). |
| POST | /gold/publish | Manual publish now (queued delivery; idempotent per config+day+change). |

## WooCommerce (`wordpress` module)
| Method | Path | Purpose |
|---|---|---|
| GET | /wordpress/sites | List sites + connection info (secret shown once at creation). |
| POST | /wordpress/sites | Create site → `{publicId, secret(once)}` for plugin pairing. |
| POST | /wordpress/sites/:id/rotate-secret | Rotate HMAC secret. |
| DELETE | /wordpress/sites/:id | Revoke. |
| GET | /wordpress/sites/:id/products | Synced products (paginated). |
| POST | /wordpress/sites/:id/sync | Trigger pull-sync (queued). |

## Provider webhooks (public, signature-checked)
| Method | Path | Auth |
|---|---|---|
| POST | /webhooks/telegram/:botId | Header `X-Telegram-Bot-Api-Secret-Token` == bot.webhookSecret (hash_equals). |
| POST | /webhooks/bale/:botId | Header `X-Telegram-Bot-Api-Secret-Token` when provider supports; else required custom header `X-Postyar-Secret` set via Bale webhook params. Dedup by update id. |
| POST | /webhooks/wordpress/:publicId | Header `X-Postyar-Signature: sha256=<HMAC(body, site secret)>`, timestamp tolerance 5 min, body ≤ 256KB. |
| GET | /r/:code | Public click redirect (302 to stored URL only; open-redirect safe). |

## Billing
| Method | Path | Purpose |
|---|---|---|
| GET | /plans | Public plan list (Persian names, limits, prices). |
| GET | /subscription | Current subscription + plan + limits. |
| GET | /subscription/usage | Effective plan + days remaining + usage vs plan limits: `{plan, subscriptionStatus, expiresAt, daysRemaining, usage: {posts, channels, bots}}` — each counter mirrors its enforcing gate (posts created this UTC month, channels not DISCONNECTED, all owned bots). |
| POST | /subscription/change | `{planId, renew?}` → creates payment (SUBSCRIPTION purpose) → gateway redirect URL; `renew: true` re-purchases the CURRENT active plan (skips the same-plan conflict; expiry extends without losing days); zero-price applies instantly; MOCK gateway returns a purpose-aware SPA return path (`/app/subscription?mock_payment=…`). |
| POST | /payments | `{purpose, planId?, amount?}` create ONLINE payment → `{redirectUrl}`. PAYMENT_ERROR (Persian) when the online gateway is disabled in admin payment settings. |
| GET | /payments | History (paginated; rows include `method` (ONLINE\|CARD) and `reference` for card payments). |
| GET | /billing/payment-methods | Available payment methods (auth): `{ online: { enabled, gateway }, card: { enabled, number, holder } }` — driven by admin payment settings; card info present ONLY when card-to-card is enabled. |
| POST | /payments/card | Card-to-card request `{purpose, planId?, amount?, reference(4..64)}` → 201 `{paymentId, amount, status: 'PENDING'}` — method=CARD, gateway=CARD; awaits admin approval. |
| GET | /payments/callback/:gateway?payment_id=..&Authority=.. | Browser return; server-to-server verify; idempotent; wallet/subscription effects transactional; returns redirect path for SPA. CARD-method payments are never resolvable via callbacks (404). |
| GET | /wallet | Balance + recent entries. |
| GET | /wallet/entries | Ledger (paginated). |
| POST | /wallet/topup | Create WALLET_TOPUP payment. |
| GET | /referrals | Own code, referred users, total rewards. |

## Notifications / analytics / media / support / admin
| Method | Path | Purpose |
|---|---|---|
| GET | /notifications | List (paginated, unread filter). |
| POST | /notifications/:id/read, /notifications/read-all | Mark read. |
| GET | /analytics/overview?days=14 | KPI cards (posts sent, success rate, bot messages, AI credits). |
| GET | /analytics/publishing?days=30 | Daily series for charts. |
| GET | /analytics/channels, /analytics/bots, /analytics/ai | Domain reports. |
| GET | /analytics/timeline?cursor= | Activity timeline (cursor). |
| POST | /media | Multipart upload (image/*, ≤10MB, magic-byte check, WebP convert when applicable). |
| GET | /media, /media/:id | List / metadata. |
| GET | /media/:id/content | Authorized streaming (owner or admin only). |
| GET/POST | /support/tickets | List / create ticket. Create accepts JSON **or** `multipart/form-data` with the same fields + ONE optional `attachment` file (image/jpeg\|png\|webp\|gif\|application/pdf, ≤5MB, magic-byte checked; stored PRIVATE via the media pipeline). |
| GET | /support/tickets/:id | Thread (messages ascending; each message carries `attachment: {id, originalName, mime, size} \| null`). |
| POST | /support/tickets/:id/messages | Reply — JSON `{body}` or multipart `{body}` + optional `attachment` (same policy). Users may only attach files they uploaded themselves. |
| GET | /support/attachments/:id | Authorized attachment download/stream: ticket owner or staff only; anyone else gets a uniform 404 (no existence leak). |
| GET | /admin/stats | Platform KPIs (SUPER_ADMIN/ADMIN only). |
| GET | /admin/users | Users list (paginated; NEVER password hashes). |
| PATCH | /admin/users/:id | role/status change (audited, server-checked). |
| GET | /admin/audit-logs | Audit trail (paginated, filterable). |
| GET | /admin/payments | Operational list (rows include `method` and `reference`). |
| POST | /admin/payments/:id/approve | Approve a PENDING card-to-card payment → applies verified effects exactly once (shared `payment-verify:{id}` idempotency key); audited; user notified. |
| POST | /admin/payments/:id/reject | Reject a PENDING card-to-card payment `{reason?}` → FAILED + audited; user notified. |
| GET | /admin/tickets | Ticket list. |
| GET | /admin/tickets/:id | Admin view of any ticket thread (incl. attachment metadata). |
| PATCH | /admin/tickets/:id | Ticket status change (audited). |
| POST | /admin/tickets/:id/reply | Staff reply. |
| GET/PATCH | /admin/plans, /admin/plans/:id | Plan management. |
| GET/PATCH | /admin/settings | System settings (referral reward, retention days). |
| GET/PUT | /admin/settings/payment | Payment settings (ADMIN guarded, audited on save): `{ onlineGatewayEnabled, onlineGateway: ZARINPAL\|IDPAY\|ZIBAL\|MOCK, cardEnabled, cardNumber(16 digits), cardHolder }` → settings keys `payment.online_gateway_enabled`, `payment.online_gateway`, `payment.card_enabled`, `payment.card_number`, `payment.card_holder`. |

## Behavioral contracts
- All tenant queries derive ownership from session user; IDs never grant access (IDOR-safe).
- Plan limits (channels/bots/posts/AI/storage/schedules) enforced in service layer before mutations.
- Money: BIGINT Rial; wallet mutation = transactional `SELECT ... FOR UPDATE` + ledger insert with `balance_after`.
- Payments: `method` ONLINE|CARD. ONLINE rows walk the gateway session + callback verify; CARD (card-to-card) rows are created PENDING with the user's transfer reference and settle ONLY via admin approve/reject — approve reuses the verified-effects path with the shared `payment-verify:{id}` idempotency key. When the admin disables the online gateway, ONLINE payment creation fails with a Persian PAYMENT_ERROR pointing to card-to-card.
- Ticket attachments: image/PDF ≤5MB, magic-byte sniffed (client mime never trusted), stored PRIVATE under the media storage root; downloads only through the ownership-checked support endpoint.
- Idempotency keys: payment verification, wallet moves, referral rewards, delivery enqueue, expiry notices (`expiry-7d:{subscriptionId}`), WP webhook events, gold publishes.
- Delivery retries: exponential backoff (60s, 5m, 30m, 2h, 6h), classified errors — permanent/validation/auth errors never retry.
- 7-day expiry notice: exactly once per subscription (durable unique key), delivered to configured channels + in-app.
