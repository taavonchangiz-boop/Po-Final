/**
 * Vitest unit tests for the core kernel (pure — no DB, no Redis, no server).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

/* Env must be set BEFORE importing modules that read it (crypto -> config/env). */
let crypto: typeof import('../core/crypto.js');
let errors: typeof import('../core/errors.js');
let envelope: typeof import('../core/envelope.js');
let http: typeof import('../core/http.js');

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'mysql://root:root@localhost:3306/postyar_test';
  process.env['ENCRYPTION_KEY'] = '0123456789abcdef0123456789abcdef'; // 32-char test key
  crypto = await import('../core/crypto.js');
  errors = await import('../core/errors.js');
  envelope = await import('../core/envelope.js');
  http = await import('../core/http.js');
});

describe('isPrivateIp range checks', () => {
  it('detects private IPv4 ranges', () => {
    expect(http.isPrivateIp('10.1.2.3')).toBe(true);
    expect(http.isPrivateIp('172.16.0.1')).toBe(true);
    expect(http.isPrivateIp('172.31.255.255')).toBe(true);
    expect(http.isPrivateIp('192.168.1.1')).toBe(true);
    expect(http.isPrivateIp('127.0.0.1')).toBe(true);
    expect(http.isPrivateIp('169.254.169.254')).toBe(true); // metadata
    expect(http.isPrivateIp('0.0.0.0')).toBe(true);
    expect(http.isPrivateIp('100.64.0.1')).toBe(true);
    expect(http.isPrivateIp('192.0.0.9')).toBe(true);
  });

  it('allows public IPv4 and rejects out-of-range boundaries', () => {
    expect(http.isPrivateIp('8.8.8.8')).toBe(false);
    expect(http.isPrivateIp('172.32.0.1')).toBe(false); // outside 172.16/12
    expect(http.isPrivateIp('100.128.0.1')).toBe(false); // outside 100.64/10
    expect(http.isPrivateIp('192.0.1.9')).toBe(false); // outside 192.0.0/24
  });

  it('detects private IPv6 and IPv4-mapped addresses', () => {
    expect(http.isPrivateIp('::1')).toBe(true);
    expect(http.isPrivateIp('fd00::1')).toBe(true); // fc00::/7
    expect(http.isPrivateIp('fe80::1')).toBe(true); // fe80::/10
    expect(http.isPrivateIp('::ffff:10.0.0.1')).toBe(true); // mapped private v4
    expect(http.isPrivateIp('2606:4700::1111')).toBe(false); // public v6
  });
});

describe('AES-256-GCM secret roundtrip', () => {
  it('encrypts and decrypts Persian secrets', () => {
    const plaintext = 'توکن ربات: 12345:ABC-secret';
    const payload = crypto.encryptSecret(plaintext);
    expect(payload).not.toContain(plaintext);
    expect(crypto.decryptSecret(payload)).toBe(plaintext);
  });

  it('throws on tampered ciphertext', () => {
    const payload = crypto.encryptSecret('data');
    const raw = Buffer.from(payload, 'base64');
    const last = raw.length - 1;
    raw[last] = (raw[last] ?? 0) ^ 0xff;
    expect(() => crypto.decryptSecret(raw.toString('base64'))).toThrow();
  });
});

describe('error classification', () => {
  it('maps HTTP statuses to ErrorClass', () => {
    expect(errors.classifyHttpError(400)).toBe('Validation');
    expect(errors.classifyHttpError(401)).toBe('Authentication');
    expect(errors.classifyHttpError(403)).toBe('Authorization');
    expect(errors.classifyHttpError(404)).toBe('Permanent');
    expect(errors.classifyHttpError(429)).toBe('RateLimited');
    expect(errors.classifyHttpError(500)).toBe('Transient');
    expect(errors.classifyHttpError(503)).toBe('Transient');
  });
});

describe('error envelope via errorHandler', () => {
  const handler = () => envelope.errorHandler();

  function fakeReply() {
    const captured: { status?: number; body?: unknown } = {};
    const reply = {
      status(code: number) {
        captured.status = code;
        return reply;
      },
      send(body: unknown) {
        captured.body = body;
        return reply;
      },
    };
    return { reply: reply as unknown as FastifyReply, captured };
  }
  const fakeRequest = { id: 'req-test-1', method: 'POST', url: '/api/v1/x' } as unknown as FastifyRequest;

  it('renders AppError with Persian message and stable code', () => {
    const { reply, captured } = fakeReply();
    handler()(errors.validationError('نام کاربری معتبر نیست.') as unknown as FastifyError, fakeRequest, reply);
    expect(captured.status).toBe(400);
    const body = captured.body as { success: boolean; error: { code: string; message: string; requestId: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('نام کاربری معتبر نیست.');
    expect(body.error.requestId).toBe('req-test-1');
  });

  it('hides internal error details and uses the generic Persian message', () => {
    const { reply, captured } = fakeReply();
    handler()(errors.internal(new Error('db password leak')) as unknown as FastifyError, fakeRequest, reply);
    const body = captured.body as { error: { code: string; message: string } };
    expect(captured.status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('خطای داخلی سرور. لطفاً بعداً تلاش کنید.');
    expect(JSON.stringify(body)).not.toContain('db password leak');
  });

  it('maps ZodError to VALIDATION_ERROR with Persian field messages', () => {
    const { reply, captured } = fakeReply();
    const result = z.object({ mobile: z.string() }).safeParse({});
    if (result.success) throw new Error('expected parse failure');
    handler()(result.error as unknown as FastifyError, fakeRequest, reply);
    const body = captured.body as { error: { code: string; fields: Record<string, string> } };
    expect(captured.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.fields['mobile']).toBe('این فیلد الزامی است.');
  });
});
