import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { users, sessions } from '../../db/schema.js';
import { AppError, ERR } from '../../core/errors.js';
import { verifyPassword, hashPassword, passwordPolicyOk } from '../../security/passwords.js';
import { createSession, setSessionCookie, clearSessionCookie, revokeAllUserSessions } from '../../security/sessions.js';
import { issueCsrfToken } from '../../security/csrf.js';
import { audit } from '../../core/audit.js';
import { newId } from '../../core/ids.js';
import { parseWith } from '../../core/validation.js';

function auth(req: FastifyRequest): { id: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id };
}

const settingsSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  businessName: z.string().min(1).max(160),
  businessType: z.string().min(1).max(80),
  timezone: z.string().min(1).max(64),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users/me/settings', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const db = getDb();
    const [u] = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        mobile: users.mobile,
        businessName: users.businessName,
        businessType: users.businessType,
        timezone: users.timezone,
      })
      .from(users)
      .where(eq(users.id, me.id))
      .limit(1);
    if (!u) throw new AppError(ERR.AUTH_REQUIRED());
    return { success: true, data: u };
  });

  app.put('/users/me/settings', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const input = parse(settingsSchema, req.body);
    const db = getDb();
    await db
      .update(users)
      .set({
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        businessName: input.businessName.trim(),
        businessType: input.businessType.trim(),
        timezone: input.timezone.trim(),
      })
      .where(eq(users.id, me.id));
    await audit({ action: 'user.settings_updated', actorId: me.id, subjectType: 'user', subjectId: me.id, ip: req.ip });
    return { success: true, data: { ok: true } };
  });

  app.post('/users/me/change-password', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const me = auth(req);
    const input = parse(changePasswordSchema, req.body);
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
    if (!u) throw new AppError(ERR.AUTH_REQUIRED());

    const ok = await verifyPassword(u.passwordHash, input.currentPassword);
    if (!ok) throw new AppError(ERR.VALIDATION('رمز عبور فعلی نادرست است.'));
    if (!passwordPolicyOk(input.newPassword)) throw new AppError(ERR.WEAK_PASSWORD());
    if (input.newPassword === input.currentPassword) {
      throw new AppError(ERR.VALIDATION('رمز جدید باید با رمز فعلی متفاوت باشد.'));
    }

    const passwordHash = await hashPassword(input.newPassword);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, u.id));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, u.id));
    });
    await audit({ action: 'user.password_changed', actorId: u.id, subjectType: 'user', subjectId: u.id, ip: req.ip });
    // Re-issue a fresh session + CSRF secret for the current device
    const session = await createSession(u.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(reply, session.token);
    return { success: true, data: { ok: true, csrfToken: issueCsrfToken(session.csrfSecret) } };
  });

  // Account deletion readiness (§173): anonymize + suspend, transactional.
  app.delete('/users/me', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const me = auth(req);
    const db = getDb();
    const id = me.id;
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          status: 'SUSPENDED',
          email: `deleted+${id}@postyar.invalid`,
          mobile: `del-${id.slice(0, 16)}`,
          firstName: 'کاربر',
          lastName: 'حذف‌شده',
          businessName: 'حذف‌شده',
          businessType: 'deleted',
          passwordHash: `!deleted:${newId()}`, // invalid hash — verify always fails
        })
        .where(eq(users.id, id));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, id));
    });
    await audit({
      action: 'user.account_deleted',
      actorId: id,
      subjectType: 'user',
      subjectId: id,
      ip: req.ip,
      meta: { anonymized: true },
    });
    clearSessionCookie(reply);
    return { success: true, data: { ok: true, message: 'حساب شما غیرفعال و اطلاعات شناسایی شما ناشناس‌سازی شد.' } };
  });
}
