# Postyar — Product Specification (v1.0.0)

## 1. Product definition
پُستیار (Postyar) is a Persian-first SaaS platform for managing content publishing, channels, bots, automation, AI, WooCommerce integration, gold-rate publishing, subscriptions, notifications, and analytics across **Telegram, Bale, and Rubika**.

Core proposition:
```
یک بار بساز → مقصدها را انتخاب کن → الان یا زمان‌بندی‌شده منتشر کن → همه‌چیز را رصد کن
```

## 2. Reference intelligence (evidence: audits/asovin, audits/woo-hooman-channel-manager)
Reproduced behaviors (from forensic audits):
- **Channel registry + publishing**: create post → select channels → publish now/schedule → per-channel delivery state with retries (asovin ChannelManager/Sender; whcm sender pipeline).
- **Gold module**: price entry → change detection → formatted Persian publish (rial÷10 convention kept as configurable formatting, Jalali timestamp, Persian digits) (whcm Gold; asovin GoldTicker).
- **Bots**: token connect + getMe verify, commands, keyword autoresponder, inbox of received messages (whcm Inbox/Sender; asovin auto_replies/inbox).
- **AI copywriting**: OpenAI-compatible providers with tenant-supplied keys, Persian prompt templates, fallback templates (whcm AI_Copywriter). Postyar generalizes to provider abstraction + queue.
- **WooCommerce**: auto-publish on product publish with once-only guard, product sync, live-price caption edit, click tracking with cookie attribution (whcm ROI_Tracker/Sender). Postyar moves the brain into the SaaS; the plugin is a thin signed adapter.
- **Wallet/referral/subscription**: ledger-based wallet with balance_after (asovin wallet_transactions), referral rewards with idempotency, plan quotas (asovin Quota).
- **Jalali scheduling**: Jalali→Gregorian conversion at the UI boundary, storage in UTC (whcm jalali-picker; asovin triplicated converters — unified into one kernel here).

Rejected reference patterns (documented in audits): plaintext secrets, webhook without signature, unbounded click INSERTs, double-send races between heartbeat and cron, password hashes returned by admin API, float money, module system dead code, runtime auto-DDL in request path.

## 3. Personas & flows
- **Business owner (USER)**: registers → connects channels/bots → publishes/schedules → watches analytics → pays subscription / tops up wallet → gets support.
- **Platform admin (SUPER_ADMIN/ADMIN)**: manages users, plans, tickets, audit, settings, platform KPIs.

Primary flows:
1. Registration (with optional referral code) → auto FREE plan subscription + wallet.
2. Connect channel (token encrypted, verify getChat) → channel list with health.
3. Compose post (media optional) → select channels → publish now or Jalali schedule → delivery tracking per channel.
4. Bot connect → verify → commands/autoresponder/workflows/AI replies → inbox events.
5. WooCommerce: create site in dashboard → install Postyar Connector → paste publicId+secret → product sync + auto-publish.
6. Gold: enter/import price → configure channel+frequency+template → automated formatted publishes.
7. Billing: choose plan → payment gateway → verified server-side → subscription activated (idempotent); wallet top-up; referral reward on referred user's first verified payment.
8. 7-day expiry warning: one durable notice per subscription → in-app + configured channels.

## 4. Feature matrix (v1 scope)
| Domain | Capabilities |
|---|---|
| Channels | Telegram/Bale/Rubika, encrypted credentials, verify, health, limits |
| Publishing | drafts, media, targets, outbox→queue→worker→delivery states, retries, cancel, retry-now |
| Scheduling | Jalali UI, timezone-aware, recurrence, pause/cancel, idempotent execution |
| Bots | connect/verify/enable/disable, commands, capability map, events, bot users, health |
| Workflows | trigger + steps (send message/buttons, AI reply, wait, condition), safety limits, runs |
| AI | providers (OpenAI/Gemini/DeepSeek/Claude/OpenRouter/Mistral/Custom), queued jobs, usage quota |
| Gold | prices, configs per channel, frequency, template, change detection, manual publish |
| WooCommerce | site pairing (HMAC), product sync, auto-publish events, diagnostics |
| Billing | 5 plans, gateway abstraction (Zarinpal/IDPay/Zibal/Mock), verify idempotency |
| Wallet | ledger (CREDIT/DEBIT/REFUND/BONUS/PAYMENT/ADJUSTMENT), balance_after, FOR UPDATE |
| Referrals | code, referral rows, idempotent reward on first verified payment |
| Notifications | in-app + channel fan-out, 7-day expiry unique notice |
| Analytics | events + daily read model + reports (publishing/channels/bots/AI/timeline) |
| Support | tickets + thread + staff replies |
| Admin | stats, users, plans, audit, settings, payments, tickets |
| Media | private storage, magic-byte checks, size/mime limits, authorized streaming |

## 5. Non-functional contracts
- **Language**: 100% Persian user-facing UI; technical enums internal only.
- **Digits**: Persian digits everywhere user-visible (shared formatter).
- **Calendar**: Jalali everywhere user-visible; storage UTC.
- **RTL**: foundation-level (`dir="rtl"`, logical CSS properties).
- **Font**: Vazirmatn (official assets).
- **Brand**: official logo family from `po/` assets; no substitute mark.
- **Responsive**: mobile-first 360→1440+.
- **Accessibility**: keyboard, focus management, ARIA, contrast.
- **Security**: see SECURITY.md — Argon2id, HttpOnly SameSite session cookies, CSRF double-submit, rate limits, SSRF guards, AES-256-GCM secrets at rest, HMAC webhooks, tenant isolation.
- **Performance**: pagination everywhere, bounded worker concurrency, indexed access paths, daily read model for dashboards, code-split frontend.

## 6. Plan limits (seed)
| Plan | channels | posts/month | aiCredits | bots | schedules | storageMb | price (Rial/month) |
|---|---|---|---|---|---|---|---|
| رایگان | 2 | 30 | 20 | 1 | 5 | 200 | 0 |
| پایه | 5 | 200 | 150 | 2 | 50 | 1,000 | 990,000 |
| حرفه‌ای | 15 | 1,000 | 800 | 5 | 300 | 5,000 | 2,490,000 |
| تجاری | 40 | 5,000 | 3,000 | 15 | 1,500 | 20,000 | 5,990,000 |
| سازمانی | 200 | 50,000 | 20,000 | 50 | 10,000 | 100,000 | 14,900,000 |

## 7. Out of scope (v1, documented)
- Live end-to-end provider calls require real bot tokens/gateway/AI credentials (adapters + config documented; failure policy per master prompt §155).
- Email/SMS sending requires provider credentials (abstraction + adapters provided).
- Load testing on shared hosting is forbidden by contract; not executed.
