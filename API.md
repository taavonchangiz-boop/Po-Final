# Postyar — API Reference (v1)

Generated from the implemented route modules (`app/src/modules/*/`); every listed route exists in code. Base URL: `${API_URL}/api/v1` unless noted. Health routes live outside the namespace.

## Conventions

**Success** (HTTP 200 unless noted): `{"success": true, "data": <payload>}`
**Error (§58)**: `{"success": false, "error": {"code": "<CODE>", "message": "<Persian user-safe message>", "requestId": "<uuid>"}}`

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400/422 | zod boundary rejection (Persian message) |
| `UNAUTHORIZED` / `AUTH_REQUIRED` | 401 | no/invalid session |
| `FORBIDDEN` | 403 | permission/plan-feature denied |
| `CSRF_INVALID` | 403 | missing/invalid `x-csrf-token` on mutating call |
| `QUOTA_EXCEEDED` | 403 | plan limit reached (`limits_json`) |
| `NOT_FOUND` | 404 | resource missing or foreign |
| `CONFLICT` | 409 | e.g. channel already claimed by another tenant |
| `WEAK_PASSWORD` | 422 | password policy |
| `RATE_LIMITED` | 429 | rate limit / provider throttle |
| `PROVIDER_UNAUTHORIZED` | 502 | bot token rejected by platform |
| `PROVIDER_NOT_SUPPORTED` | 400 | capability absent (never emulated) |
| `PROVIDER_UNAVAILABLE` / `PROVIDER_RATE_LIMITED` | 502/429 | transient platform issues (auto-retried) |
| `INTERNAL_ERROR` | 500 | unexpected (safe Persian message) |
| `BAD_REQUEST` / `PAYLOAD_TOO_LARGE` / `NOT_FOUND` | 400/413/404 | framework-level, same envelope |

**Auth**: opaque session cookie `py_session` (SameSite=Lax). All mutating methods require header `x-csrf-token` (token from `POST /auth/*` responses or `GET /auth/me`). Exempt from CSRF: `POST /api/v1/webhooks/*` and `GET /api/v1/payments/callback` (server-to-server/browser-redirect routes).

**Pagination**: `?page` (default 1) + `?pageSize` (default 20, max 100 where zod-validated) → `{items, total, page, pageSize}`. Analytics events use **cursor** pagination instead (see below).

**IDs**: ULID (26 chars). **Money**: integer rials.

---

## Health (outside /api/v1)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health/live` | — | `{status:"live",time}` — liveness only |
| GET | `/health/ready` | — | `{status:"ready"|"degraded",checks:{mysql,redis},env}` — real SELECT 1 + PING |
| GET | `/health/` | — | `{status:"ok",service:"postyar-api"}` |

## Auth — `auth.routes.ts`

| Method | Path | Auth | Body / Query | Returns |
|---|---|---|---|---|
| POST | `/auth/register` | — (rate 5/h) | `{firstName,lastName,mobile,email,businessName,businessType,password,passwordRepeat,acceptTerms:true,referralCode?}` | `{user,csrfToken}`; sets session cookie; auto-login; referral register reward |
| POST | `/auth/login` | — (rate 10/15 min) | `{identifier (email or mobile),password}` | `{user,csrfToken}`; rotates sessions |
| POST | `/auth/logout` | ✓ | — | `{ok:true}`; revokes session |
| GET | `/auth/me` | ✓ | — | `{user,subscription:{id,state,expiresAt,planName,planCode}|null,csrfToken}` |
| POST | `/auth/password-reset` | — (5/h) | `{email}` | generic `{ok,message}` — no enumeration |
| POST | `/auth/password-reset/confirm` | — (10/h) | `{token,password}` | `{ok:true}` |

`user` = `{id,firstName,lastName,email,businessName,role}`.

## Users — `user.routes.ts` (all ✓)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/users/me/settings` | — | profile (incl. mobile, timezone) |
| PUT | `/users/me/settings` | `{firstName,lastName,businessName,businessType,timezone}` | `{ok:true}` |
| POST | `/users/me/change-password` | `{currentPassword,newPassword}` | `{ok:true,csrfToken}`; re-issues session, revokes others |
| DELETE | `/users/me` | — | anonymize + suspend account, clears cookie |

## Channels — `channel.routes.ts` (all ✓)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/channels` | — | `{channels[]}` (no secrets; includes status/health) |
| POST | `/channels` | `{platform:telegram\|bale\|rubika,channelRef,title,botId?}` | `{channel}`; registry anti-cheat claim (409 if foreign); PENDING_VERIFY until verify |
| GET | `/channels/capabilities` | `?platform=` | `{platform,capabilities}` (live provider caps: sendText/sendMedia/editMessage/deleteMessage/inlineButtons/replyKeyboard/webhook/polling/botIdentity/htmlParseMode) |
| POST | `/channels/:id/verify` | — | `{channel}` (ACTIVE + lastVerifiedAt on success) |
| POST | `/channels/:id` | `{title}` | `{channel}` |
| DELETE | `/channels/:id` | — | `{channel}` (disconnect) |

## Posts & publishing — `publishing/post.routes.ts` (all ✓)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/posts` | `{title?,body≤4000,parseMode?:NONE\|HTML\|MARKDOWN,mediaId?,buttons?{inline[≤8]{label,url?,callback?},links[≤8]{label,url}}}` | `{post}` (DRAFT) |
| POST | `/posts/:id/publish` | `{channelIds[1..20]}` | `{post}` (QUEUED; outbox `post.publish`; plan limit `posts`) |
| POST | `/posts/:id/schedule` | `{channelIds,scheduledAt:ISO}` | `{post}` (SCHEDULED; limit `schedules`) |
| GET | `/posts` | `?page&pageSize≤100&state&search` | page `{items,page,pageSize,total}` + per-post target state counts |
| GET | `/posts/:id` | — | `{post,targets[]}` (attempts/errorMessage/sentAt/nextRetryAt/channelTitle/platform) |
| POST | `/posts/:id/cancel` | — | `{post}` (SCHEDULED/QUEUED only) |
| POST | `/posts/targets/:targetId/retry` | — | target reset to PENDING + requeue |

## Bots — `bot.routes.ts`

| Method | Path | Auth | Body / Query | Returns |
|---|---|---|---|---|
| POST | `/bots` | ✓ | `{platform,token,title?}` | `{bot}` (token encrypted; masked only ever returned) |
| GET | `/bots` | ✓ | — | `{items[]}` (tokenMasked) |
| POST | `/bots/:id/verify` | ✓ | — | verify against provider getMe |
| POST | `/bots/:id/enable` | ✓ | — | `{bot}`; registers webhook `${API_URL}/api/v1/webhooks/bots/:id?s=<secret>` for webhook-capable platforms |
| POST | `/bots/:id/disable` | ✓ | — | `{bot}` |
| POST | `/bots/:id/mode` | ✓ | `{mode:WEBHOOK\|POLLING}` | `{bot}` |
| PUT | `/bots/:id/ai` | ✓ | `{aiEnabled,aiSystemPrompt?≤4000}` | `{bot}` |
| GET | `/bots/:id/users` | ✓ | `?page&pageSize` | page of bot_users (firstSeen/lastSeen) |
| GET | `/bots/:id/stats` | ✓ | — | message/callback events, sent30d, userCount |
| GET | `/bots/:id/capabilities` | ✓ | — | `{capabilities}` (UI gating, §16) |
| GET/POST | `/bots/:id/commands` | ✓ | `{command,descriptionFa?,responseKind:TEXT\|BUTTONS\|AI\|WORKFLOW,responsePayload?}` | `{items[]}` / `{command}` |
| PUT | `/bots/:id/commands` | ✓ | `{commandId,…fields?}` | `{command}` (body-id form) |
| DELETE | `/bots/:id/commands` | ✓ | `?commandId` | `{deleted:true}` |
| PUT/DELETE | `/bots/commands/:cmdId` | ✓ | body / — | `{command}` / `{deleted:true}` (path-id form) |
| GET/POST | `/bots/:id/keywords` | ✓ | `{keyword,matchKind:EXACT\|CONTAINS,responseKind,responsePayload?}` | `{items[]}` / `{keyword}` |
| PUT/DELETE | `/bots/keywords/:kwId` | ✓ | body / — | `{keyword}` / `{deleted:true}` |
| POST | `/webhooks/bots/:botId` | **public** (rate 600/min, CSRF-exempt) | provider update JSON, `?s=<secret>` | always `{success:true}` (no oracle; dedup via `bot_events`) |

`responsePayload` (strict): `{text≤4000?, buttons[≤8]?, systemPrompt≤4000?, workflowId?}` — kind-dependent.

## Workflows — `workflow.routes.ts` (all ✓)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/workflows` | `?page&pageSize` | `{items[],page,pageSize,total,runCount}` |
| POST | `/workflows` | `{botId,nameFa,definition}` (server re-validates recursively: ≤20 steps, WAIT 1–60 s, nesting ≤2, AI ≤2) | `{workflow}` |
| PUT | `/workflows/:id` | `{nameFa?,definition?,isEnabled?}` | `{workflow}` |
| DELETE | `/workflows/:id` | — | `{deleted:true}` |
| POST | `/workflows/:id/enable` / `/disable` | — | `{workflow}` |
| GET | `/workflows/:id/runs` | `?page&pageSize` | page of runs (status/stepsExecuted/errorCode) |

## AI — `ai.routes.ts` (all ✓; quota `ai_monthly`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/ai/caption` | `{text≤4000}` | `{jobId}` — queued; poll the job |
| GET | `/ai/jobs/:id` | — | `{job}` (status QUEUED/RUNNING/COMPLETED/FAILED, output, tokens) |
| GET | `/ai/usage` | — | `{periodYm,requestCount,tokenCount}` |
| POST | `/ai/generate` | `{text,system?}` | `{text,provider}` — synchronous, 30 s, settings testing |

## Subscriptions & payments — `subscription.routes.ts`, `payment.routes.ts`

| Method | Path | Auth | Body / Query | Returns |
|---|---|---|---|---|
| GET | `/subscriptions/plans` | — | — | `{plans[]}` (public catalog) |
| GET | `/subscriptions/me` | ✓ | — | `{subscription,plan{limits,features},usage{channels,bots,postsThisPeriod,scheduled,aiRequestsThisMonth}}` |
| POST | `/subscriptions/checkout` | ✓ | `{planCode,months 1–12}` | payment `{redirectUrl,…}` (ZarinPal) |
| POST | `/payments/wallet-topup` | ✓ | `{amountRial 100000–2000000000}` | `{redirectUrl,…}` |
| GET | `/payments` | ✓ | `?page&pageSize` | page (no authority/gateway refs exposed) |
| GET | `/payments/callback` | **public** (CSRF-exempt) | `?paymentId&Authority&Status` | **302** → `APP_URL/dashboard/wallet?payment=ok|failed` (server-side ZarinPal verify, idempotent) |

## Wallet · referrals · gold — `wallet.routes.ts`, `referral.routes.ts`, `gold.routes.ts` (all ✓)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/wallet` | — | `{balanceRial,points,ledger[],transactions…}` summary |
| POST | `/wallet/convert-points` | `{points 100–1000000}` | conversion result (10 rial/point) |
| GET | `/referrals/me` | — | `{code,rewards,referred[]}` (self-healing register reward) |
| GET | `/gold/config` | — | `{config}` (403 `FORBIDDEN` without plan feature `gold_ticker`) |
| PUT | `/gold/config` | `{sourceUrl,templateText,channelIds≤20,frequencyMinutes 15–1440,timezone,changeOnly,isEnabled}` | `{config}` (SSRF-checked at save) |
| POST | `/gold/run` | — | `{result}` (immediate fetch+publish if changed) |

## Analytics — `analytics.routes.ts` (all ✓)

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/analytics/overview` | — | `{channels{total,active},bots{…},posts{total,published},deliveries{sent30d,failed30d},wallet{balanceRial},ai{periodYm,requestCount,tokenCount}}` |
| GET | `/analytics/events` | `?cursor&limit≤100` | `{events[],nextCursor}` — cursor = last ULID `id` (`id < cursor`) |
| GET | `/analytics/daily` | `?days≤60` (default 14) | `{days,series:[{day,eventName,count}]}` from `event_daily` |

## Media — `media.routes.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/media` | ✓ | multipart, single file ≤8 MB (10 MB stream cap), jpeg/png/gif/webp magic-checked → `{media:{id,filename,mime,sizeBytes}}` |
| GET | `/media` | ✓ | `?page&pageSize` page |
| DELETE | `/media/:id` | ✓ | removes row + access tokens |
| GET | `/media/:id/token` | ✓ | 15-min hashed token → `{url}` (`/media/raw/:id?token=…`) |
| GET | `/media/raw/:id` | **public** | streams bytes (token + expiry validated); `cache-control: private, max-age=300` |

## WordPress — `wordpress.routes.ts`

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/wordpress/sites` | ✓ | `{siteUrl}` → `{site{id,siteUrl,siteKey},secret}` — **secret shown once** |
| GET | `/wordpress/sites` | ✓ | `{sites[]}` |
| DELETE | `/wordpress/sites/:id` | ✓ | removes site + products |
| POST | `/wordpress/sites/:id/rotate-secret` | ✓ | new one-time secret |
| GET | `/wordpress/products` | ✓ | `?page&pageSize` synced products |
| POST | `/webhooks/wordpress` | **public** (rate 60/min, CSRF-exempt) | headers `x-postyar-site-key`+`x-postyar-secret`; body `{"action":"sync_products","products":[≤200]}` or `{"action":"publish_product","product":{…}}`; 401 `UNAUTHORIZED` / 422 / 403 `QUOTA_EXCEEDED` shapes |

Protocol details: [WORDPRESS.md](WORDPRESS.md) · Persian protocol spec: `docs/WORDPRESS.md`.

## Notifications — `notification.routes.ts` (all ✓)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/notifications` | `?page&pageSize≤100&unreadOnly=true` | `{items[],total,page,pageSize}` |
| POST | `/notifications/:id/read` | — | `{ok:true}` |
| POST | `/notifications/read-all` | — | `{ok:true}` |
| GET | `/notifications/preferences` | — | `{categories:[{key,labelFa,descriptionFa,enabled}]}` (6 static Persian categories) |
| PUT | `/notifications/preferences` | `{prefs:{<CATEGORY_KEY>:bool}}` | `{ok:true}` |

## Support — `support.routes.ts` (all ✓)

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/support/tickets` | `?page&pageSize` | `{…page,categories}` (static Persian categories) |
| POST | `/support/tickets` | `{subject 3–190,category?,body 5–5000}` | ticket (state OPEN) |
| GET | `/support/tickets/:id` | — | thread (support role sees any ticket) |
| POST | `/support/tickets/:id/messages` | `{body≤5000}` | message (author role inferred) |
| POST | `/support/tickets/:id/close` | — | `{ok:true}` (state CLOSED) |

## Admin — `admin.routes.ts` (permission-gated; audited to `audit_logs`)

| Method | Path | Permission | Body / Query | Returns |
|---|---|---|---|---|
| GET | `/admin/overview` | `admin.access` | — | platform KPIs (users, revenue30d, …) |
| GET | `/admin/users` | `admin.access` | `?search&page&pageSize` | page of users |
| POST | `/admin/users/:id/suspend` · `/activate` | `admin.users.manage` | — | `{ok:true}` |
| POST | `/admin/users/:id/grant-subscription` | `admin.users.manage` | `{planCode,months 1–12}` | granted subscription |
| GET | `/admin/payments` | `admin.access` | `?state&page&pageSize` | page of payments |
| POST | `/admin/payments/:id/approve` | `admin.payments.review` | — | approved payment (manual gateway confirmation) |
| GET | `/admin/audit-logs` | `admin.access` | `?action&page&pageSize` | page of audit entries |
| GET | `/admin/plans` | `admin.access` | — | `{plans[]}` |
| PUT | `/admin/plans/:id` | `admin.plans.manage` | `{nameFa?,priceRial?,limitsJson?,featuresJson?}` | `{ok:true}` |
| GET/PUT | `/admin/settings` | `admin.settings.manage` | key→JSON-object map | `{settings}` / `{updated}` |
| POST | `/admin/broadcast` | `admin.broadcast` | `{titleFa,bodyFa≤5000}` | `{notified}` (in-app fan-out) |
| POST | `/admin/channel-registry/release` | `admin.users.manage` | `{platform,channelRef}` | `{ok:true}` (frees an anti-cheat claim) |

Roles: SUPER_ADMIN = all permissions · SUPPORT = `admin.access`,`support.tickets.any` · USER = none.
