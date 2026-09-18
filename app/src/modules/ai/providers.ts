/**
 * AI provider adapters: one call-shape per provider family, all through
 * fetchWithTimeout (60s), bounded max_tokens (1024) and temperature ≤ 1.
 *
 *  - OPENAI / DEEPSEEK / OPENROUTER / MISTRAL / CUSTOM → OpenAI-compatible
 *    /chat/completions with per-provider base URLs.
 *  - GEMINI → generativelanguage generateContent.
 *  - CLAUDE → anthropic /messages (x-api-key + anthropic-version).
 *
 * CUSTOM reads AI_CUSTOM_BASE_URL + AI_CUSTOM_API_KEY directly from the
 * process environment (env.ts is a foundation file and intentionally untouched;
 * these are optional operator settings, documented in the deployment guide).
 *
 * No key configured → resolveAiAdapter returns null → the caller fails the job
 * HONESTLY (errorClass Authentication, Persian message) — never fake success.
 */
import { providerError, unauthenticated } from '../../core/errors.js';
import { classifyProviderError, type ErrorClass } from '../../core/errors.js';
import { fetchWithTimeout } from '../../core/http.js';
import { logger } from '../../core/logger.js';
import { env } from '../../config/env.js';

export type AiProviderName = 'OPENAI' | 'GEMINI' | 'DEEPSEEK' | 'CLAUDE' | 'OPENROUTER' | 'MISTRAL' | 'CUSTOM';

export interface AiCompletionInput {
  system: string;
  prompt: string;
  model?: string;
  /** Hard-bounded downstream: never above 1024. */
  maxTokens?: number;
  /** Clamped to ≤ 1. */
  temperature?: number;
}

export interface AiAdapter {
  provider: AiProviderName;
  defaultModel: string;
  complete(input: AiCompletionInput): Promise<string>;
}

const TIMEOUT_MS = 60_000;
const MAX_TOKENS_CAP = 1024;

function clampMaxTokens(maxTokens?: number): number {
  if (maxTokens === undefined || !Number.isFinite(maxTokens)) return MAX_TOKENS_CAP;
  return Math.max(16, Math.min(MAX_TOKENS_CAP, Math.trunc(maxTokens)));
}

function clampTemperature(temperature?: number): number {
  if (temperature === undefined || !Number.isFinite(temperature)) return 0.7;
  return Math.max(0, Math.min(1, temperature));
}

/** Convert any adapter/network failure into (ErrorClass, safe Persian message). */
export function classifyAiFailure(err: unknown): { errorClass: ErrorClass; message: string } {
  const errorClass = classifyProviderError(err);
  const status = err instanceof Error && 'status' in err ? Number((err as { status?: unknown }).status) : undefined;
  if (status === 401 || status === 403) {
    return { errorClass: 'Authentication', message: 'کلید سرویس هوش مصنوعی نامعتبر است. با مدیر سیستم تماس بگیرید.' };
  }
  if (status === 429) {
    return { errorClass: 'RateLimited', message: 'سرویس هوش مصنوعی در لحظه شلوغ است. کمی بعد تلاش کنید.' };
  }
  switch (errorClass) {
    case 'Network':
    case 'Transient':
      return { errorClass, message: 'ارتباط با سرویس هوش مصنوعی برقرار نشد. کمی بعد تلاش کنید.' };
    case 'Authentication':
      return { errorClass, message: 'کلید سرویس هوش مصنوعی تنظیم نشده یا نامعتبر است. با مدیر سیستم تماس بگیرید.' };
    default:
      return { errorClass, message: 'پردازش درخواست هوش مصنوعی ناموفق بود. لطفاً بعداً تلاش کنید.' };
  }
}

/* ------------------------- OpenAI-compatible family ------------------------- */

const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<AiProviderName, string>> = {
  OPENAI: 'https://api.openai.com/v1',
  DEEPSEEK: 'https://api.deepseek.com/v1',
  OPENROUTER: 'https://openrouter.ai/api/v1',
  MISTRAL: 'https://api.mistral.ai/v1',
  CUSTOM: process.env['AI_CUSTOM_BASE_URL']?.replace(/\/+$/, '') || 'https://api.openai.com/v1',
};

const DEFAULT_MODELS: Record<AiProviderName, string> = {
  OPENAI: 'gpt-4o-mini',
  GEMINI: 'gemini-1.5-flash',
  DEEPSEEK: 'deepseek-chat',
  CLAUDE: 'claude-3-haiku-20240307',
  OPENROUTER: 'openrouter/auto',
  MISTRAL: 'mistral-small-latest',
  CUSTOM: 'gpt-4o-mini',
};

function openAiCompatible(provider: AiProviderName, apiKey: string): AiAdapter {
  const baseUrl = OPENAI_COMPATIBLE_BASE_URLS[provider] ?? 'https://api.openai.com/v1';
  return {
    provider,
    defaultModel: DEFAULT_MODELS[provider],
    async complete(input) {
      const res = await fetchWithTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
            ...(provider === 'OPENROUTER' ? { 'HTTP-Referer': env.APP_URL, 'X-Title': 'Postyar' } : {}),
          },
          body: JSON.stringify({
            model: input.model ?? DEFAULT_MODELS[provider],
            messages: [
              { role: 'system', content: input.system },
              { role: 'user', content: input.prompt },
            ],
            max_tokens: clampMaxTokens(input.maxTokens),
            temperature: clampTemperature(input.temperature),
          }),
        },
        TIMEOUT_MS,
      );
      if (!res.ok) {
        await res.text().catch(() => '');
        const err = new Error(`ai_provider_http_${res.status}`) as Error & { status?: number };
        err.status = res.status;
        if (res.status === 401 || res.status === 403) throw unauthenticated('کلید سرویس هوش مصنوعی نامعتبر است.');
        throw providerError('سرویس هوش مصنوعی پاسخ نامعتبر داد.');
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || text.length === 0) {
        throw providerError('پاسخی از سرویس هوش مصنوعی دریافت نشد.');
      }
      return text;
    },
  };
}

/* --------------------------------- Gemini --------------------------------- */

function geminiAdapter(apiKey: string): AiAdapter {
  const base = 'https://generativelanguage.googleapis.com/v1beta/models';
  return {
    provider: 'GEMINI',
    defaultModel: DEFAULT_MODELS.GEMINI,
    async complete(input) {
      const model = input.model ?? DEFAULT_MODELS.GEMINI;
      const res = await fetchWithTimeout(
        `${base}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: input.system }] },
            contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
            generationConfig: {
              maxOutputTokens: clampMaxTokens(input.maxTokens),
              temperature: clampTemperature(input.temperature),
            },
          }),
        },
        TIMEOUT_MS,
      );
      if (!res.ok) {
        await res.text().catch(() => '');
        const err = new Error(`ai_provider_http_${res.status}`) as Error & { status?: number };
        err.status = res.status;
        if (res.status === 401 || res.status === 403) throw unauthenticated('کلید سرویس هوش مصنوعی نامعتبر است.');
        throw providerError('سرویس هوش مصنوعی پاسخ نامعتبر داد.');
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (text.length === 0) throw providerError('پاسخی از سرویس هوش مصنوعی دریافت نشد.');
      return text;
    },
  };
}

/* --------------------------------- Claude --------------------------------- */

function claudeAdapter(apiKey: string): AiAdapter {
  return {
    provider: 'CLAUDE',
    defaultModel: DEFAULT_MODELS.CLAUDE,
    async complete(input) {
      const res = await fetchWithTimeout(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: input.model ?? DEFAULT_MODELS.CLAUDE,
            max_tokens: clampMaxTokens(input.maxTokens),
            temperature: clampTemperature(input.temperature),
            system: input.system,
            messages: [{ role: 'user', content: input.prompt }],
          }),
        },
        TIMEOUT_MS,
      );
      if (!res.ok) {
        await res.text().catch(() => '');
        const err = new Error(`ai_provider_http_${res.status}`) as Error & { status?: number };
        err.status = res.status;
        if (res.status === 401 || res.status === 403) throw unauthenticated('کلید سرویس هوش مصنوعی نامعتبر است.');
        throw providerError('سرویس هوش مصنوعی پاسخ نامعتبر داد.');
      }
      const json = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
      const text = json.content?.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('') ?? '';
      if (text.length === 0) throw providerError('پاسخی از سرویس هوش مصنوعی دریافت نشد.');
      return text;
    },
  };
}

function apiKeyFor(provider: AiProviderName): string | null {
  switch (provider) {
    case 'OPENAI':
      return env.OPENAI_API_KEY ?? null;
    case 'GEMINI':
      return env.GEMINI_API_KEY ?? null;
    case 'DEEPSEEK':
      return env.DEEPSEEK_API_KEY ?? null;
    case 'CLAUDE':
      return env.CLAUDE_API_KEY ?? null;
    case 'OPENROUTER':
      return env.OPENROUTER_API_KEY ?? null;
    case 'MISTRAL':
      return env.MISTRAL_API_KEY ?? null;
    case 'CUSTOM':
      return process.env['AI_CUSTOM_API_KEY'] ?? null;
    default:
      return null;
  }
}

/**
 * Resolve an adapter for a provider, or null when no key is configured.
 * Callers MUST translate null into an honest FAILED job (never silence).
 */
export function resolveAiAdapter(provider: AiProviderName): AiAdapter | null {
  const key = apiKeyFor(provider);
  if (key === null || key.trim().length === 0) {
    logger.warn('ai_provider_not_configured', { provider });
    return null;
  }
  switch (provider) {
    case 'GEMINI':
      return geminiAdapter(key);
    case 'CLAUDE':
      return claudeAdapter(key);
    default:
      return openAiCompatible(provider, key);
  }
}
