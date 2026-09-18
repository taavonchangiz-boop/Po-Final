# Postyar — Database Guide — v1.0.0

پایگاه‌داده: MySQL/MariaDB، charset `utf8mb4`، ORM = Drizzle (ADR-003). مرجع کامل و متعارف اسکیمای `app/src/db/schema.ts` است و migrationهای SQL در `database/migrations/`. این سند نمای کلی است و با اسکیما همگام نگه داشته می‌شود.

## 1. Conventions / قواعد سراسری

| قاعده | جزئیات |
|---|---|
| پول | **BIGINT — ریال صحیح.** هرگز float/decimal برای پول (ADR-013). نمایش تومانی فقط لایه نمایش |
| زمان | **UTC در ذخیره‌سازی** (`timestamp`)؛ تبدیل به Jalali فقط در مرز UI (`frontend/src/lib/format.ts`) |
| چند‌مستأجری | هر ردیف متعلق به مستأجر، ستون `user_id` دارد؛ همه‌ی کوئری‌های خواندن/نوشتن ownership را از session کاربر مشتق می‌کنند (`app/src/security/tenant.ts`) — ID از URL هرگز مجوز نمی‌دهد (IDOR-safe) |
| شناسه‌ها | `BIGINT AUTO_INCREMENT` داخلی؛ شناسه‌های عمومی (site pairing، referral code) توکن تصادفی جدا |
| اسرار | توکن بات/کانال/وردپرس با AES-256-GCM رمز می‌شوند (`app/src/core/crypto.ts`) — هرگز plaintext، هرگز در response بعد از ذخیره |
| Idempotency | جدول `idempotency_keys` — پرداخت، انتقال کیف پول، پاداش معرفی، enqueue delivery، اعلان انقضا (`expiry-7d:{id}`)، رویداد WP، انتشار طلا |
| Outbox | رویدادها در همان تراکنش business-state در `outbox_events` می‌نشینند (ADR-008) |

## 2. Tables (37) / جداول

### Identity و دسترسی (4)
| جدول | هدف |
|---|---|
| `users` | حساب کاربران؛ رمز Argon2id؛ فیلدهای کسب‌وکار؛ `role` (USER/ADMIN/SUPER_ADMIN)؛ کد معرفی |
| `system_bootstrap` | قفل تک‌ردیفی «اولین ادمین» — INSERT موفق ⇒ SUPER_ADMIN، خطای کلید تکراری ⇒ USER (ADR-007) |
| `sessions` | نشست‌های اپاک؛ فقط SHA-256 هش توکن؛ چرخش/ابطال؛ کوکی `py_session` HttpOnly |
| `password_resets` | توکن بازیابی (هش‌شده، ۳۰ دقیقه، تک‌مصرف) |

### Billing و مالی (6)
| جدول | هدف |
|---|---|
| `plans` | پلن‌ها (PRODUCT-SPEC §6) با سقف channels/posts/ai/bots/schedules/storage و قیمت ریالی |
| `subscriptions` | اشتراک فعال هر کاربر + تاریخ انقضا؛ مبنای اعمال سقف‌ها در لایه سرویس |
| `payments` | پرداخت‌ها: CREATED→VERIFIED/FAILED؛ purpose (SUBSCRIPTION/WALLET_TOPUP)؛ verify idempotent |
| `wallets` | موجودی جاری هر کاربر (تک‌ردیف) |
| `wallet_entries` | دفتر کل تراکنشی: CREDIT/DEBIT/REFUND/BONUS/PAYMENT/ADJUSTMENT + `balance_after` + کلید idempotency یکتا |
| `referrals` | کد دعوت/معرفی‌شدگان؛ پاداش فقط روی اولین پرداخت verify شده (idempotent) |

### Channels و Bots و Workflows (6)
| جدول | هدف |
|---|---|
| `channels` | کانال‌های Telegram/Bale/Rubika؛ توکن رمزشده؛ وضعیت PENDING/ACTIVE/ERROR/DISCONNECTED |
| `bots` | بات‌های ثبت‌شده؛ verify getMe؛ فرمان‌ها؛ پیکربندی AI؛ وضعیت وب‌هوک |
| `bot_events` | رویدادهای دریافتی بات (dedupe با update id)؛ پاکسازی ۳۰ روزه |
| `bot_users` | کاربران بات (حداقل داده‌ی مجاز توسط ارائه‌دهنده) |
| `workflows` | تعریف trigger+steps؛ اعتبارسنجی سمت سرور با capability registry |
| `workflow_runs` | تاریخچه اجرای workflow |

### Publishing و رسانه (7)
| جدول | هدف |
|---|---|
| `media` | متادیتای رسانه (ملکیت، visibility، mime، magic-byte check)؛ محتوا در `storage/` |
| `posts` | پست‌ها: DRAFT/SCHEDULED/PUBLISHING/PUBLISHED/FAILED/PARTIAL/CANCELLED |
| `deliveries` | تک‌مصردی هر (پست×کانال): PENDING→PROCESSING→SENT/RETRYING/FAILED/CANCELLED + تلاش‌ها و backoff |
| `schedules` | زمان‌بندی‌ها: ONCE/DAILY/WEEKLY/MONTHLY؛ runAt در UTC؛ pause/cancel |
| `outbox_events` | صف خروج تراکنشی (ADR-008)؛ worker آن‌ها را به BullMQ می‌پمپد؛ شکست enqueue ⇒ requeue +60s |
| `idempotency_keys` | کلیدهای idempotency با scope + انقضا |
| `link_targets` | لینک‌های کوتاه رهگیری کلیک (`/r/:code`)؛ شمارش کلیک؛ ۳۰۲ فقط به URL ذخیره‌شده |

### AI (2)
| جدول | هدف |
|---|---|
| `ai_jobs` | کارهای AI در صف: QUEUED→PROCESSING→COMPLETED/FAILED + credits_used |
| `ai_usage` | مصرف ماهانه per-user (`uq_ai_usage`) — مبنای سقف پلن |

### WooCommerce (3)
| جدول | هدف |
|---|---|
| `wordpress_sites` | سایت‌های ووکامرس جفت‌شده: publicId + HMAC secret (رمزشده) |
| `wp_products` | محصولات sync شده (pull-sync صف‌شده) |
| `wp_events` | رویدادهای ورودی وب‌هوک وردپرس (HMAC + timestamp 5min + بدنه ≤256KB) |

### Gold (2)
| جدول | هدف |
|---|---|
| `gold_prices` | آخرین قیمت هر asset per-tenant |
| `gold_configs` | پیکربندی انتشار خودکار طلا per-channel (assets، frequency، timeOfDay، template) |

### Analytics (2)
| جدول | هدف |
|---|---|
| `events` | رویدادهای append-only (cursor pagination بر id)؛ بدون credential/متن پیام |
| `daily_stats` | read model روزانه — scheduler تجمیع می‌کند؛ داشبورد فقط aggregate می‌خواند (ADR-011) |

### Platform (5)
| جدول | هدف |
|---|---|
| `notifications` | اعلان‌های in-app + unread count |
| `audit_logs` | رد حسابرسی عملیات حساس (role change، rotate token، …) |
| `support_tickets` | تیکت‌های پشتیبانی |
| `ticket_messages` | پیام‌های تیکت (کاربر/پشتیبان) |
| `settings` | تنظیمات سراسری (پاداش معرفی، retention days و …) |

## 3. Migration workflow / گردش‌کار migration

```bash
# توسعه (روی سیستم توسعه‌دهنده — هرگز روی هاست اشتراکی):
cd app
npx drizzle-kit generate        # تغییر schema.ts → database/migrations/XXXX_*.sql

# استقرار (روی هاست — از build، نه tsx):
set -a; source app/.env; set +a
node app/dist/db/migrate.js     # ← همان کاری که deploy.sh انجام می‌دهد
```

- Runner (`app/src/db/migrate.ts`): هر فایل SQL را مرتب بر نام فایل، داخل یک transaction، اعمال و در `__postyar_migrations` ثبت می‌کند؛ فایل‌های اعمال‌شده skip می‌شوند.
- Seed (`npm run db:seed`): فقط پلن‌ها و تنظیمات پیش‌فرض، insert-if-missing، هرگز overwrite نمی‌کند.

## 4. Drift policy / سیاست ناهماهنگی

1. **Forward-only:** فایل migration اعمال‌شده هرگز ویرایش/حذف/تغییرنام نمی‌شود؛ اصلاح همیشه migration جدید است.
2. **Refuse-on-drift:** اگر migrationی ثبت‌شده در DB از دیسک غایب باشد (حذف/تغییرنام)، runner با خطا متوقف می‌شود — «توقف، نه حدس» (master prompt §201).
3. **DB جلوتر از کد؟** یعنی restore جزئی یا deploy معکوس — با `restore-db.sh` و dump هماهنگ بازگردید؛ دست‌کاری `__postyar_migrations` فقط با بازبینی انسانی.
4. **Destructive change** (drop/بازنویسی ستون): دو فاز — فاز ۱ افزودن ستون جدید و دو-نویسی، فاز ۲ حذف قدیم پس از استقرار کامل؛ هرگز در یک migration.

## 5. Backups / پشتیبان‌گیری

- روزانه با `scripts/backup-db.sh` (mysqldump --single-transaction → `postelrobbal/backups/*.sql.gz`، نگهداری ۱۴ روز) — خط cron در DEPLOYMENT.md §11.
- بازیابی: `scripts/restore-db.sh` (پرامپت تأیید + بکاپ ایمنی پیش از restore).
