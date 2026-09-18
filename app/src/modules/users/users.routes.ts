/**
 * Profile routes (authenticated). Only names + business fields are editable —
 * email/mobile changes are deliberately NOT exposed here to avoid introducing
 * verification flows in v1 (Persian messages throughout).
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { sendOk } from '../../core/envelope.js';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { requireUser } from '../../security/current-user.js';
import { requireAuth } from '../../security/session.js';

const NAME_REGEX = /^[\u0600-\u06FF\u200ca-zA-Z\s]{2,100}$/;

const profileSchema = z
  .object({
    firstName: z.string().regex(NAME_REGEX, 'نام معتبر نیست.').optional(),
    lastName: z.string().regex(NAME_REGEX, 'نام خانوادگی معتبر نیست.').optional(),
    businessName: z.string().trim().min(2, 'نام کسب‌وکار الزامی است.').max(190).optional(),
    businessType: z.string().trim().min(2, 'نوع فعالیت کسب‌وکار الزامی است.').max(100).optional(),
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'داده‌ای برای بروزرسانی ارسال نشده است.' });

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/profile', { preHandler: requireAuth }, async (request, reply) => {
    const current = requireUser(request);
    const rows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        mobile: users.mobile,
        businessName: users.businessName,
        businessType: users.businessType,
        role: users.role,
        status: users.status,
        referralCode: users.referralCode,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, current.id))
      .limit(1);
    return sendOk(reply, { profile: rows[0] ?? null });
  });

  app.patch('/api/v1/profile', { preHandler: requireAuth }, async (request, reply) => {
    const current = requireUser(request);
    const patch = profileSchema.parse(request.body);

    await db
      .update(users)
      .set({
        ...(patch.firstName !== undefined ? { firstName: patch.firstName.trim() } : {}),
        ...(patch.lastName !== undefined ? { lastName: patch.lastName.trim() } : {}),
        ...(patch.businessName !== undefined ? { businessName: patch.businessName } : {}),
        ...(patch.businessType !== undefined ? { businessType: patch.businessType } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, current.id));

    const rows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        mobile: users.mobile,
        businessName: users.businessName,
        businessType: users.businessType,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, current.id))
      .limit(1);
    return sendOk(reply, { profile: rows[0] ?? null, message: 'پروفایل با موفقیت بروزرسانی شد.' });
  });
}
