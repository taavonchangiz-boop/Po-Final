# Postyar — Database

Engine: **MySQL 8 / MariaDB ≥ 10.6**, `utf8mb4` / `utf8mb4_unicode_ci`, InnoDB everywhere, session time zone `+00:00`. All identifiers are **ULID `CHAR(26)`** (lexicographically sortable). Money is stored as **BIGINT rials** (ADR-0012) — never floats. Multi-tenancy: `tenant_id === users.id` on every tenant-owned row.

Access layer: `app/src/db/client.ts` (mysql2 pool via drizzle-orm) with the schema mapping in `app/src/db/schema.ts`.

---

## Migration workflow

The runner (`app/src/db/migrate.ts`, exposed by `app/src/db/migrate-cli.ts`) is **deterministic and file-driven**:

1. Ensures `schema_migrations(name VARCHAR(190) PK, applied_at)` exists.
2. Lists `database/migrations/*.sql`, sorts **lexically**, and applies each file **exactly once** inside a transaction (`BEGIN → run file → INSERT INTO schema_migrations → COMMIT`); any failure rolls back and aborts the deploy.
3. **Drift detection**: if the DB records an applied migration whose file is not present in the release, the runner **aborts instead of guessing**.

**How to add migration `0003_*.sql`:**

1. Change tables in `app/src/db/schema.ts` first (drizzle is the mapping of record) and update the affected services.
2. Author the SQL by hand at `database/migrations/0003_<topic>.sql` (the repo intentionally has **no `drizzle.config.ts`** — `drizzle-kit` is available as a devDependency if you want to diff, but the committed SQL file is the source of truth; never let a tool auto-apply anything). Keep the header comment style of `0001_init.sql`, use `SET NAMES utf8mb4;` and explicit `ENGINE=InnoDB ... CHARSET=utf8mb4`.
3. Migrations must be **forward-only and deterministic** (no `NOW()`-dependent DDL, no data backfills that depend on external state). Never edit an already-released migration — add a new one.
4. Verify locally: `cd app && bun run migrate` (applies 0003 on a fresh or dev DB; re-run prints `Already up to date.`).
5. Review the SQL like code, then commit **schema change + migration together**. Deploys only *apply existing files* — they never generate schema.

## Drift policy

- The runner refuses to run when the database knows migrations the release does not ship (ahead-of-release drift).
- Deploy (`scripts/deploy.sh`) prints applied vs present before applying, and fails on drift.
- Out-of-band `ALTER TABLE` on production is forbidden; it *is* drift and must be reconciled by adding the missing migration to the repo, not by hand-editing both sides.

## Connection pool guidance

- One pool per process (`DB_POOL_MAX`, default **5**, zod-clamped 2–20). Process budget per deployment: API ×1, Worker ×1, Scheduler ×1 (tick, short-lived) → worst case ≈ 2×`DB_POOL_MAX` + 1 concurrent connections.
- The scheduler and workers run the same pool settings; on small shared hosts keep `DB_POOL_MAX=5` (contract default) and raise only with the DBA/host plan (`max_connections`).
- Long transactions are forbidden — the delivery worker claims rows with single atomic `UPDATE ... WHERE state IN (...)` statements instead of holding transactions across provider HTTP calls.

## Backup advice

- Enable daily `mysqldump --single-transaction --routines --triggers` (cPanel backups or cron) plus weekly full + binary logs if available. Exclude nothing — the DB is the system of record (wallet ledger, referrals, payments).
- `postelrobbal/private` / `STORAGE_DIR` holds uploaded media **outside** the DB — back it up with the same schedule; media rows (`media.storage_path`) are useless without the files.
- Redis is a **queue/cache only** — losing it loses pending jobs and rate-limit counters, never business data (the outbox in MySQL is the source of truth for publishing). No Redis persistence config is required beyond defaults.
- Test restores quarterly; a backup that has never been restored is a hypothesis.

---

## Table catalog (41 tables, from `database/migrations/0001_init.sql`)

### Identity & access

| Table | Purpose | Key columns / indexes |
|---|---|---|
| `users` | Tenants = accounts; also staff roles | `email`/`mobile`/`referral_code` UNIQUE; `role` ENUM(SUPER_ADMIN,SUPPORT,USER), `status` ENUM(ACTIVE,SUSPENDED), `password_hash` (argon2id) |
| `sessions` | Server-side sessions (ADR-0006) | `token_hash` UNIQUE (sha256 of cookie), `csrf_secret`, `expires_at`, `revoked_at`, `idx_sessions_user` |
| `password_reset_tokens` | Single-use reset tokens | `token_hash` UNIQUE, `expires_at`, `used_at` |

### Plans & subscriptions

| Table | Purpose | Key columns / indexes |
|---|---|---|
| `plans` | Catalog (seeded: free/basic/professional/business/enterprise) | `code` UNIQUE; `price_rial`, `period_days`, `limits_json`, `features_json` |
| `subscriptions` | Tenant plan state machine | `idx_subs_tenant_state`, `idx_subs_expiry(state,expires_at)`; FK→users, plans; state ACTIVE/EXPIRED/CANCELLED |

### Channels & bots

| Table | Purpose | Key columns / indexes |
|---|---|---|
| `channel_registry` | Platform-wide anti-cheat claim map (one tenant per channel_ref) | PK (`platform`,`channel_ref`); `tenant_id` NULL until claimed; `claimed_at`/`released_at` |
| `channels` | Tenant channels (telegram/bale/rubika) | UNIQUE (`tenant_id`,`platform`,`channel_ref`); `bot_id`, `status` ENUM(PENDING_VERIFY,ACTIVE,DISABLED,ERROR), `health_json` |
| `bots` | Bot connections; token **AES-256-GCM encrypted** (`token_encrypted`) + masked copy | `webhook_secret` CHAR(64), `webhook_url`, `mode` WEBHOOK/POLLING, `ai_enabled`, `ai_system_prompt` |
| `bot_users` | End users seen by a bot | UNIQUE (`bot_id`,`platform_user_id`); `first_seen_at`/`last_seen_at`, `state_json` |
| `bot_commands` | `/command` auto-responses | UNIQUE (`bot_id`,`command`); `response_kind` ENUM(TEXT,BUTTONS,AI,WORKFLOW), `response_payload` JSON |
| `bot_keywords` | Keyword auto-responses | `idx_bot_keywords_bot`; `match_kind` EXACT/CONTAINS |
| `bot_events` | Raw provider updates, deduped | UNIQUE (`bot_id`,`dedup_hash`) = replay protection; `state` PENDING/PROCESSED/FAILED |
| `workflows` | No-code bot workflow definitions | `definition_json`; `run_count`; FK bot |
| `workflow_runs` | Deterministic interpreter runs | `status` RUNNING/COMPLETED/FAILED/TIMEOUT/ABORTED; `steps_executed`, `log_json` |

### Publishing pipeline

| Table | Purpose | Key columns / indexes |
|---|---|---|
| `media` | Uploaded files (private storage) | `checksum` sha256, `storage_path`, size/mime; `idx_media_tenant` |
| `media_access_tokens` | 15-min signed URLs for provider fetch | `token_hash` UNIQUE (sha256), `expires_at` |
| `posts` | Post aggregate | `state` ENUM(DRAFT,SCHEDULED,QUEUED,PUBLISHING,PUBLISHED,PARTIAL,FAILED,CANCELLED); `source` MANUAL/GOLD/WORDPRESS/WORKFLOW; `idx_posts_tenant_state`, `idx_posts_schedule(state,scheduled_at)` |
| `post_targets` | Per-channel delivery rows (dedup: UNIQUE post+channel) | `state` PENDING/PROCESSING/SENT/RETRYING/FAILED/CANCELLED, `attempts`, `next_retry_at`, `provider_message_id`; `idx_pt_retry(state,next_retry_at)` |
| `outbox_events` | **Transactional outbox** — written in the same tx as state change | `state` PENDING/DISPATCHED/FAILED; `idx_outbox_pending(state,created_at)` |
| `idempotency_keys` | Exactly-once guards for dangerous operations | PK (`scope`,`idem_key`); `state` IN_PROGRESS/COMPLETED/FAILED, `expires_at` |

### AI

| Table | Purpose | Key columns / indexes |
|---|---|---|
| `ai_jobs` | Queued caption/reply jobs | `purpose` CAPTION/AUTO_REPLY/CUSTOM, `provider`, `status` QUEUED/RUNNING/COMPLETED/FAILED, token counts |
| `ai_usage_monthly` | Quota counters | PK (`tenant_id`,`period_ym`); request/token counts |

### WordPress / WooCommerce

| Table | Purpose | Key columns / indexes |
|---|---|---|
| `wordpress_sites` | Connected sites | `site_key` UNIQUE, `secret_hash` (sha256 of one-time secret), `auto_publish`, UNIQUE (`tenant_id`,`site_url`) |
| `wordpress_products` | Synced product cache | UNIQUE (`site_id`,`wc_product_id`), `content_hash` change detection, `last_published_at` |

### Gold ticker

| Table | Purpose | Key columns / indexes |
|---|---|---|
| `gold_configs` | One config per tenant (UNIQUE tenant) | `source_url` (SSRF-checked), `template_text`, `channel_ids` JSON, `frequency_minutes` ≥15, `change_only` |
| `gold_snapshots` | Parsed price snapshots | `content_hash` change detection, `published` flag, `idx_gold_snap(config_id,captured_at)` |

### Money

| Table | Purpose | Key columns / indexes |
|---|---|---|
| `payments` | Gateway payments (ZarinPal) | UNIQUE (`gateway`,`authority`); `purpose` SUBSCRIPTION/WALLET_TOPUP; state CREATED→REDIRECTED→VERIFIED/FAILED/CANCELLED/REFUNDED |
| `wallet_accounts` | One balance row per tenant | PK `tenant_id`, `balance_rial` BIGINT |
| `wallet_ledger` | Append-only wallet movements | `entry_kind` CREDIT/DEBIT/REFUND/BONUS/PAYMENT/ADJUSTMENT; `balance_after` snapshot; **UNIQUE (`ref_type`,`ref_id`,`entry_kind`)** enforces exactly-once postings |
| `point_ledger` | Loyalty points ledger | `entry_kind` EARN/SPEND/ADJUSTMENT, `balance_after` |
| `referrals` | Referral graph | UNIQUE (`referred_tenant_id`) — a referred user counts once |
| `referral_rewards` | Reward per cause | UNIQUE (`referral_id`,`reward_kind`) — REGISTER/FIRST_PURCHASE once each |

### Notifications, analytics, support, ops

| Table | Purpose | Key columns / indexes |
|---|---|---|
| `notifications` | In-app inbox | `kind`, `title_fa`/`body_fa`, `read_at`; `idx_notif_tenant(tenant_id,created_at)` |
| `notification_outbound` | Fan-out delivery records (in-app/telegram/email/sms/…) | UNIQUE (`kind`,`subject_id`,`destination`) = idempotent sends; `state` PENDING/SENT/FAILED/SKIPPED |
| `events` | Append-only analytics events (no PII/credentials in props) | `idx_events_tenant_time`, `idx_events_name`; cursor pagination uses ULID `id` |
| `event_daily` | Pre-aggregated per-day counters | PK (`tenant_id`,`day`,`event_name`) |
| `audit_logs` | Security-relevant admin/actor actions | `idx_audit_actor`, `idx_audit_action`; `meta_json` |
| `tickets` | Support tickets | `state` OPEN/ANSWERED/CLOSED; `category` |
| `ticket_messages` | Ticket thread | `author_role` USER/SUPPORT/SUPER_ADMIN/SYSTEM; `idx_tmsg_ticket(ticket_id,created_at)` |
| `system_settings` | Global key→JSON settings (also per-tenant prefs like `notif_pref:<tenant>`) | PK `setting_key`, `value_json` |
| `link_clicks` | Button/link click tracking | `visitor_hash` (no raw PII), `post_target_id`, `idx_clicks_tenant`, `idx_clicks_target` |

### Seed data (`0002_seed.sql`)

- 5 plans (`free`, `basic` 9.9M, `professional` 24.9M, `business` 59.9M rial/month, `enterprise` custom) with `limits_json` (`max_channels`, `max_posts`, `max_bots`, `max_schedules`, `ai_monthly`, `storage_mb`; `0` = unlimited) and `features_json` (`gold_ticker`, `auto_responder`, `woocommerce`, `api_access`).
- `system_settings`: `referral` (100 pts register, 10 % first purchase, 5000 monthly cap, 10 rial/point), `gold` (default source tgju.org, 60 min, change-only), `ai` (default provider openai), `sms` (smsir, 3/hour/phone), `booking` (7-day expiry warning).
