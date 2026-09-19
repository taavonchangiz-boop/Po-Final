/**
 * Idempotent seed: plans (PRODUCT-SPEC §6) + system settings defaults.
 * Insert-if-missing only — never overwrites existing rows.
 *
 * Usage: bun run db:seed  (tsx src/db/seed.ts)
 */
import { db, pool } from './client.js';
import { plans, settings } from './schema.js';

interface PlanSeed {
  code: 'FREE' | 'BASIC' | 'PRO' | 'BUSINESS' | 'ORG';
  name: string;
  description: string;
  priceMonthly: number;
  sortOrder: number;
  limits: { channels: number; postsPerMonth: number; aiCredits: number; bots: number; schedules: number; storageMb: number };
}

// PRODUCT-SPEC.md §6 — channels / postsPerMonth / aiCredits / bots / schedules / storageMb / price (Rial)
const PLAN_SEEDS: PlanSeed[] = [
  {
    code: 'FREE',
    name: 'رایگان',
    description: 'شروع رایگان برای کسب‌وکارهای کوچک',
    priceMonthly: 0,
    sortOrder: 1,
    limits: { channels: 2, postsPerMonth: 30, aiCredits: 20, bots: 1, schedules: 5, storageMb: 200 },
  },
  {
    code: 'BASIC',
    name: 'پایه',
    description: 'مناسب فروشگاه‌های در حال رشد',
    priceMonthly: 990_000,
    sortOrder: 2,
    limits: { channels: 5, postsPerMonth: 200, aiCredits: 150, bots: 2, schedules: 50, storageMb: 1_000 },
  },
  {
    code: 'PRO',
    name: 'حرفه‌ای',
    description: 'برای فروشگاه‌های فعال با انتشار منظم',
    priceMonthly: 2_490_000,
    sortOrder: 3,
    limits: { channels: 15, postsPerMonth: 1_000, aiCredits: 800, bots: 5, schedules: 300, storageMb: 5_000 },
  },
  {
    code: 'BUSINESS',
    name: 'تجاری',
    description: 'برای تیم‌ها و فروشگاه‌های پرمخاطب',
    priceMonthly: 5_990_000,
    sortOrder: 4,
    limits: { channels: 40, postsPerMonth: 5_000, aiCredits: 3_000, bots: 15, schedules: 1_500, storageMb: 20_000 },
  },
  {
    code: 'ORG',
    name: 'سازمانی',
    description: 'ظرفیت بالا برای سازمان‌ها و آژانس‌ها',
    priceMonthly: 14_900_000,
    sortOrder: 5,
    limits: { channels: 200, postsPerMonth: 50_000, aiCredits: 20_000, bots: 50, schedules: 10_000, storageMb: 100_000 },
  },
];

const GOLD_DEFAULT_TEMPLATE = [
  '📈 نرخ لحظه‌ای بازار:',
  '{table}',
  '—',
  'ارسال‌شده توسط پست‌یار',
].join('\n');

const SETTING_SEEDS: Array<{ key: string; value: unknown }> = [
  { key: 'referral_reward_amount', value: 500_000 },
  { key: 'referral_enabled', value: true },
  { key: 'retention_days', value: { events: 365, deliveries: 180, logs: 90 } },
  { key: 'gold_default_template', value: GOLD_DEFAULT_TEMPLATE },
];

async function seedPlans(): Promise<void> {
  const existing = await db.select({ code: plans.code }).from(plans);
  const existingCodes = new Set(existing.map((row) => row.code));
  const missing = PLAN_SEEDS.filter((p) => !existingCodes.has(p.code));
  if (missing.length === 0) {
    console.log('[db:seed] plans: up to date.');
    return;
  }
  await db.insert(plans).values(missing);
  console.log(`[db:seed] plans: inserted ${missing.map((p) => p.code).join(', ')}.`);
}

async function seedSettings(): Promise<void> {
  const existing = await db.select({ key: settings.key }).from(settings);
  const existingKeys = new Set(existing.map((row) => row.key));
  const missing = SETTING_SEEDS.filter((s) => !existingKeys.has(s.key));
  if (missing.length === 0) {
    console.log('[db:seed] settings: up to date.');
    return;
  }
  await db.insert(settings).values(missing.map((s) => ({ key: s.key, value: s.value })));
  console.log(`[db:seed] settings: inserted ${missing.map((s) => s.key).join(', ')}.`);
}

async function main(): Promise<void> {
  await seedPlans();
  await seedSettings();
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('[db:seed] FAILED:', err instanceof Error ? err.message : err);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
