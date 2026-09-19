import { describe, expect, it } from 'vitest';
import { canTransition, assertTransition, nextRetryDelaySeconds, DELIVERY_LABELS_FA } from '../src/core/delivery-state.js';
import { encryptSecret, decryptSecret, maskSecret } from '../src/security/encryption.js';
import { verifyCsrfToken, issueCsrfToken } from '../src/security/csrf.js';
import { roleHasPermission } from '../src/security/permissions.js';
import { referralCodeFor } from '../src/modules/auth/auth.service.js';
import { sanitizeProps, ALLOWED_EVENTS } from '../src/core/events.js';
import { isPrivateIpInternal } from './helpers.js';

process.env.DATABASE_URL ??= 'mysql://user:pass@localhost:3306/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.SESSION_SECRET ??= 'x'.repeat(48);
process.env.CSRF_SECRET ??= 'y'.repeat(48);
process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);

describe('delivery state machine (§22)', () => {
  it('allows legal transitions', () => {
    expect(canTransition('PENDING', 'PROCESSING')).toBe(true);
    expect(canTransition('PROCESSING', 'SENT')).toBe(true);
    expect(canTransition('PROCESSING', 'RETRYING')).toBe(true);
    expect(canTransition('FAILED', 'PENDING')).toBe(true); // user retry
  });
  it('rejects illegal transitions', () => {
    expect(canTransition('SENT', 'PENDING')).toBe(false);
    expect(canTransition('CANCELLED', 'PROCESSING')).toBe(false);
    expect(() => assertTransition('SENT', 'PROCESSING')).toThrow();
  });
  it('exposes Persian labels', () => {
    expect(DELIVERY_LABELS_FA.SENT).toBe('ارسال شد');
    expect(DELIVERY_LABELS_FA.FAILED).toBe('ناموفق');
  });
  it('bounded retry policy (§86)', () => {
    expect(nextRetryDelaySeconds(1)).toBe(30);
    expect(nextRetryDelaySeconds(3)).toBe(600);
    expect(nextRetryDelaySeconds(5)).toBeNull();
    expect(nextRetryDelaySeconds(99)).toBeNull();
  });
});

describe('secret encryption (§92)', () => {
  it('round-trips AES-256-GCM', () => {
    const secret = '12345:AAF-verySecretToken';
    const enc = encryptSecret(secret);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });
  it('masks credentials in API responses', () => {
    expect(maskSecret('abcdefghij')).toBe('abcd****ghij');
    expect(maskSecret('short')).toBe('****');
  });
  it('rejects tampered ciphertext', () => {
    const enc = encryptSecret('secret');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });
});

describe('csrf double submit (§59)', () => {
  it('validates issued tokens bound to session secret', () => {
    const sessionSecret = 'sess-secret-123';
    const token = issueCsrfToken(sessionSecret);
    expect(verifyCsrfToken(token, sessionSecret)).toBe(true);
    expect(verifyCsrfToken(token, 'other-session')).toBe(false);
    expect(verifyCsrfToken('forged.deadbeef', sessionSecret)).toBe(false);
    expect(verifyCsrfToken(undefined, sessionSecret)).toBe(false);
  });
});

describe('permission matrix (§115)', () => {
  it('grants admin only to admin roles', () => {
    expect(roleHasPermission('SUPER_ADMIN', 'admin.users.manage')).toBe(true);
    expect(roleHasPermission('SUPPORT', 'support.tickets.any')).toBe(true);
    expect(roleHasPermission('SUPPORT', 'admin.users.manage')).toBe(false);
    expect(roleHasPermission('USER', 'admin.access')).toBe(false);
  });
});

describe('referral codes (§36)', () => {
  it('deterministic per user', () => {
    expect(referralCodeFor('01HTESTUSER00000000000000')).toBe(referralCodeFor('01HTESTUSER00000000000000'));
    expect(referralCodeFor('a')).not.toBe(referralCodeFor('b'));
    expect(referralCodeFor('01HTESTUSER00000000000000')).toMatch(/^R[0-9A-Z]{8}$/);
  });
});

describe('analytics event hygiene (§24, §165)', () => {
  it('strips credential-like props', () => {
    const clean = sanitizeProps({ bot_token: 'x', password: 'y', title: 'ok', apiKey: 'z' });
    expect(clean).toEqual({ title: 'ok' });
  });
  it('whitelists event names', () => {
    expect(ALLOWED_EVENTS.has('post.sent')).toBe(true);
    expect(ALLOWED_EVENTS.has('not.a.real.event')).toBe(false);
  });
});

describe('SSRF guard internals (§60)', () => {
  it('blocks private ranges', () => {
    expect(isPrivateIpInternal('127.0.0.1')).toBe(true);
    expect(isPrivateIpInternal('10.0.0.5')).toBe(true);
    expect(isPrivateIpInternal('192.168.1.1')).toBe(true);
    expect(isPrivateIpInternal('169.254.169.254')).toBe(true); // cloud metadata
    expect(isPrivateIpInternal('::1')).toBe(true);
    expect(isPrivateIpInternal('8.8.8.8')).toBe(false);
  });
});
