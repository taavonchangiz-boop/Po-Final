import { ApiError } from '../../lib/api';

/**
 * Bot / workflow domain types + Persian label maps (task 4-d-1).
 *
 * Shapes verified against backend sources — intentionally defensive (all
 * fields optional, ids number|string) because lib/types.ts is read-only in
 * this wave and diverges from the real zod serializers:
 *  - app/src/modules/bots/bots.service.ts serializeBot(): isEnabled,
 *    webhookState, commands[], aiConfig (lib/types.ts lacks them).
 *  - app/src/modules/workflows/workflows.routes.ts serializeWorkflow():
 *    isActive + runCount (lib/types.ts says `enabled`, no runCount) and run
 *    status enum is RUNNING|COMPLETED|FAILED|TIMEOUT|CANCELLED (lib says SUCCESS).
 */

/* --------------------------------- types --------------------------------- */

export interface BotCommand {
  command?: string;
  description?: string;
  response?: string;
}

export interface BotAiConfig {
  enabled?: boolean;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  maxCreditsPerReply?: number;
}

/** serializeBot() output (bots.service.ts). */
export interface BotRecord {
  id: number | string;
  provider?: string;
  username?: string | null;
  title?: string | null;
  isEnabled?: boolean;
  status?: string;
  webhookState?: string;
  commands?: BotCommand[] | null;
  aiConfig?: BotAiConfig | null;
  lastError?: string | null;
  lastVerifiedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BotEventRecord {
  id: number | string;
  type?: string;
  chatId?: string | null;
  senderRef?: string | null;
  processedAt?: string | null;
  createdAt?: string;
}

export interface BotUserRecord {
  id: number | string;
  displayName?: string | null;
  externalUserId?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
}

export interface WorkflowTriggerRecord {
  type?: string;
  value?: string | null;
}

export interface WorkflowStepRecord {
  type?: string;
  config?: Record<string, unknown>;
}

/** serializeWorkflow() output (workflows.routes.ts). */
export interface WorkflowRecord {
  id: number | string;
  botId?: number | string;
  name?: string;
  definition?: { trigger?: WorkflowTriggerRecord; steps?: WorkflowStepRecord[] | null } | null;
  isActive?: boolean;
  runCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** workflow_runs row (schema.ts) — note COMPLETED, not SUCCESS. */
export interface WorkflowRunRecord {
  id: number | string;
  status?: string;
  stepsExecuted?: number;
  aiCalls?: number;
  outboundCalls?: number;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

/* --------------------------------- labels -------------------------------- */

export const botStatusLabels: Record<string, string> = {
  PENDING: 'در انتظار تأیید',
  ACTIVE: 'فعال',
  ERROR: 'خطا',
  DISABLED: 'غیرفعال',
};

export const webhookStateLabels: Record<string, string> = {
  UNREGISTERED: 'وب‌هوک ثبت نشده',
  REGISTERED: 'وب‌هوک فعال',
  POLLING: 'حالت پایش (polling)',
  FAILED: 'ثبت وب‌هوک ناموفق',
};

export const eventTypeLabels: Record<string, string> = {
  message: 'پیام',
  callback_query: 'کلیک دکمه',
  member_joined: 'عضویت',
};

export const triggerLabels: Record<string, string> = {
  COMMAND: 'دستور',
  MESSAGE_KEYWORD: 'کلیدواژه پیام',
  ANY_MESSAGE: 'هر پیام',
  NEW_MEMBER: 'عضویت جدید',
};

export const stepLabels: Record<string, string> = {
  SEND_MESSAGE: 'ارسال پیام',
  SEND_BUTTONS: 'ارسال دکمه',
  AI_REPLY: 'پاسخ هوش مصنوعی',
  WAIT: 'توقف',
  CONDITION: 'شرط',
};

export const runStatusLabels: Record<string, string> = {
  RUNNING: 'در حال اجرا',
  COMPLETED: 'تکمیل شد',
  FAILED: 'ناموفق',
  TIMEOUT: 'مهلت پایان',
  CANCELLED: 'لغو شد',
};

/** AI provider keys accepted by AiConfigSchema.provider (free string, mapped best-effort). */
export const aiProviderLabels: Record<string, string> = {
  OPENAI: 'OpenAI',
  GEMINI: 'Gemini (گوگل)',
  DEEPSEEK: 'DeepSeek',
  ANTHROPIC: 'Claude (Anthropic)',
  MISTRAL: 'Mistral',
  OPENROUTER: 'OpenRouter',
};

/* -------------------------------- helpers -------------------------------- */

const GENERIC_ERROR = 'خطای غیرمنتظره رخ داد؛ دوباره تلاش کنید.';

export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : GENERIC_ERROR;
}

/**
 * Plan-limit detection. Backend quirk: channels throw code PLAN_LIMIT, while
 * the bots service throws CONFLICT with a «سقف … ارتقا …» message — both must
 * surface the upgrade flow.
 */
export function planLimitMessage(e: unknown): string | null {
  if (e instanceof ApiError) {
    if (e.code === 'PLAN_LIMIT') return e.message;
    if (e.code === 'CONFLICT' && e.message.includes('سقف')) return e.message;
  }
  return null;
}

/** Workflow safety limits mirrored from workflows.service.ts for client hints. */
export const WORKFLOW_LIMITS = {
  maxSteps: 12,
  maxWaitSeconds: 60,
  maxAiSteps: 3,
  maxOutboundSteps: 6,
  maxConditionSteps: 3,
  maxButtons: 8,
} as const;
