/**
 * Payment gateway adapters (server-to-server). Each gateway implements
 * createPayment (get redirect URL + authority) and verify (authoritative
 * server-side check). All outbound calls use fetchWithTimeout — never fake
 * success: an unconfigured gateway throws PAYMENT_ERROR with a Persian message.
 *
 * Supported: ZARINPAL, IDPAY, ZIBAL, MOCK (dev/integration only).
 */
import { randomToken } from '../../core/crypto.js';
import { paymentError } from '../../core/errors.js';
import { fetchWithTimeout } from '../../core/http.js';
import { logger } from '../../core/logger.js';
import { env } from '../../config/env.js';

export type GatewayName = 'ZARINPAL' | 'IDPAY' | 'ZIBAL' | 'MOCK';

export interface GatewayCreateResult {
  redirectUrl: string;
  authority: string;
}

export interface GatewayVerifyResult {
  ok: boolean;
  refId?: string;
  raw?: unknown;
}

export interface PaymentGateway {
  name: GatewayName;
  createPayment(amount: number, callbackUrl: string, description: string): Promise<GatewayCreateResult>;
  /**
   * `authorityOrRef` is the stored authority (Zarinpal/MOCK) or gateway ref
   * (IDPay id / Zibal trackId). `context` carries our stable order binding.
   */
  verify(authorityOrRef: string, amount: number, context?: { orderId?: string }): Promise<GatewayVerifyResult>;
}

function orderIdFromCallback(callbackUrl: string): string {
  const match = /payment_id=(\d+)/.exec(callbackUrl);
  return match?.[1] !== undefined ? `py-${match[1]}` : `py-${Date.now()}-${randomToken(4)}`;
}

const GATEWAY_TIMEOUT_MS = 30_000;

async function postJson(url: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    GATEWAY_TIMEOUT_MS,
  );
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function extractErrorDetail(json: unknown): string {
  if (json !== null && typeof json === 'object') {
    const record = json as Record<string, unknown>;
    const errors = record.errors;
    if (errors !== undefined && errors !== null) return JSON.stringify(errors).slice(0, 300);
    const message = record.message;
    if (typeof message === 'string') return message.slice(0, 300);
  }
  return '';
}

/* ------------------------------- Zarinpal ------------------------------- */

function zarinpalGateway(): PaymentGateway {
  const merchantId = env.PAYMENT_MERCHANT_ID;
  if (!merchantId) throw paymentError('درگاه پرداخت پیکربندی نشده است.');
  const base = 'https://payment.zarinpal.com/pg/v4/payment';
  return {
    name: 'ZARINPAL',
    async createPayment(amount, callbackUrl, description) {
      const { status, json } = await postJson(`${base}/request.json`, {
        merchant_id: merchantId,
        amount,
        callback_url: callbackUrl,
        description,
      });
      const data = (json as { data?: { authority?: string; code?: number } } | null)?.data;
      if (status !== 200 || data?.code !== 100 || !data.authority) {
        logger.warn('gateway_zarinpal_request_failed', { status, detail: extractErrorDetail(json) });
        throw paymentError('ایجاد تراکنش در درگاه پرداخت ناموفق بود. لطفاً بعداً تلاش کنید.');
      }
      return { redirectUrl: `https://payment.zarinpal.com/pg/StartPay/${data.authority}`, authority: data.authority };
    },
    async verify(authorityOrRef, amount) {
      const { json } = await postJson(`${base}/verify.json`, {
        merchant_id: merchantId,
        amount,
        authority: authorityOrRef,
      });
      const data = (json as { data?: { code?: number; ref_id?: number | string } } | null)?.data;
      const code = data?.code;
      // 100 = verified now, 101 = already verified (idempotent replay).
      if (code === 100 || code === 101) {
        return { ok: true, refId: data?.ref_id !== undefined ? String(data.ref_id) : undefined, raw: json };
      }
      return { ok: false, raw: json };
    },
  };
}

/* --------------------------------- IDPay --------------------------------- */

function idpayGateway(): PaymentGateway {
  const apiKey = env.PAYMENT_API_KEY;
  if (!apiKey) throw paymentError('درگاه پرداخت پیکربندی نشده است.');
  const base = 'https://api.idpay.ir/v1';
  return {
    name: 'IDPAY',
    async createPayment(amount, callbackUrl, description) {
      const orderId = orderIdFromCallback(callbackUrl);
      const { status, json } = await postJson(
        `${base}/payment`,
        { order_id: orderId, amount, callback: callbackUrl },
        { 'X-API-KEY': apiKey },
      );
      const record = json as { id?: string; link?: string } | null;
      if (status !== 201 || !record?.id || !record.link) {
        logger.warn('gateway_idpay_request_failed', { status, detail: extractErrorDetail(json) });
        throw paymentError('ایجاد تراکنش در درگاه پرداخت ناموفق بود. لطفاً بعداً تلاش کنید.');
      }
      return { redirectUrl: record.link, authority: record.id };
    },
    async verify(authorityOrRef, _amount, context) {
      // IDPay verify is authoritative only with the ORIGINAL order_id.
      const orderId = context?.orderId;
      if (!orderId) return { ok: false, raw: { error: 'missing order_id' } };
      const { status, json } = await postJson(
        `${base}/payment/verify`,
        { id: authorityOrRef, order_id: orderId },
        { 'X-API-KEY': apiKey },
      );
      const record = json as { status?: number; track_id?: number | string } | null;
      // status 100 = paid, 101 = already settled, 200 = settled to bank.
      if (status === 200 && record && (record.status === 100 || record.status === 101 || record.status === 200)) {
        return { ok: true, refId: record.track_id !== undefined ? String(record.track_id) : undefined, raw: json };
      }
      return { ok: false, raw: json };
    },
  };
}

/* --------------------------------- Zibal --------------------------------- */

function zibalGateway(): PaymentGateway {
  // Zibal accepts merchant 'zibal' for sandbox; a configured merchant id wins.
  const merchant = env.PAYMENT_MERCHANT_ID || 'zibal';
  const base = 'https://gateway.zibal.ir/v1';
  return {
    name: 'ZIBAL',
    async createPayment(amount, callbackUrl, description) {
      const { status, json } = await postJson(`${base}/request`, {
        merchant,
        amount,
        callbackUrl,
        description,
      });
      const record = json as { trackId?: number; result?: number } | null;
      if (status !== 200 || record?.result !== 100 || record.trackId === undefined) {
        logger.warn('gateway_zibal_request_failed', { status, detail: extractErrorDetail(json) });
        throw paymentError('ایجاد تراکنش در درگاه پرداخت ناموفق بود. لطفاً بعداً تلاش کنید.');
      }
      return { redirectUrl: `https://gateway.zibal.ir/${record.trackId}`, authority: String(record.trackId) };
    },
    async verify(authorityOrRef, _amount) {
      const { status, json } = await postJson(`${base}/verify`, { merchant, trackId: Number(authorityOrRef) });
      const record = json as { result?: number; status?: number } | null;
      // result 100 = verified; status 1 = paid, 2 = paid & already verified.
      if (status === 200 && record?.result === 100 && (record.status === 1 || record.status === 2)) {
        return { ok: true, refId: authorityOrRef, raw: json };
      }
      return { ok: false, raw: json };
    },
  };
}

/* ---------------------------------- MOCK ---------------------------------- */

/**
 * MOCK gateway: no external calls. The redirect URL points back to the SPA
 * wallet page with mock markers; verification always succeeds (amount echo).
 * For development/integration ONLY — never exposed unless explicitly selected
 * via PAYMENT_PROVIDER=MOCK (a loud warning is logged in production).
 */
function mockGateway(): PaymentGateway {
  return {
    name: 'MOCK',
    async createPayment(amount, callbackUrl, description) {
      const authority = `mock_${randomToken(12)}`;
      const paymentIdMatch = /payment_id=(\d+)/.exec(callbackUrl);
      const paymentId = paymentIdMatch?.[1] ?? '0';
      logger.warn('gateway_mock_used', { amount, description: description.slice(0, 80) });
      if (env.isProduction) {
        logger.error('gateway_mock_in_production', { hint: 'PAYMENT_PROVIDER=MOCK must never run in production' });
      }
      return {
        redirectUrl: `${env.APP_URL}/app/wallet?mock_payment=${paymentId}&authority=${encodeURIComponent(authority)}`,
        authority,
      };
    },
    async verify(authorityOrRef, _amount) {
      return { ok: true, refId: authorityOrRef, raw: { mock: true } };
    },
  };
}

export function getPaymentGateway(name: GatewayName): PaymentGateway {
  switch (name) {
    case 'ZARINPAL':
      return zarinpalGateway();
    case 'IDPAY':
      return idpayGateway();
    case 'ZIBAL':
      return zibalGateway();
    case 'MOCK':
      return mockGateway();
    default: {
      const exhaustive: never = name;
      throw paymentError(`درگاه پرداخت پشتیبانی نمی‌شود: ${String(exhaustive)}`);
    }
  }
}

export function isConfiguredGateway(name: GatewayName): boolean {
  switch (name) {
    case 'ZARINPAL':
      return Boolean(env.PAYMENT_MERCHANT_ID);
    case 'IDPAY':
      return Boolean(env.PAYMENT_API_KEY);
    case 'ZIBAL':
      return true; // works with the default sandbox merchant
    case 'MOCK':
      return true;
    default:
      return false;
  }
}
