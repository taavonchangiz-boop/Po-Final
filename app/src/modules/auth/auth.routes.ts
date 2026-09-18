/**
 * Auth routes (public + authenticated). All bodies zod-parsed; responses via
 * the sendOk envelope; CSRF is enforced globally by the csrf plugin.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sendCreated, sendOk } from '../../core/envelope.js';
import { validationError } from '../../core/errors.js';
import { SESSION_COOKIE, requireAuth, SessionService } from '../../security/session.js';
import { authLimiter } from '../../security/rate-limit.js';
import {
  changePassword,
  confirmPasswordReset,
  getMeSummary,
  loginUser,
  logoutUser,
  normalizeMobile,
  registerUser,
  requestPasswordReset,
} from './auth.service.js';

/** Persian (fa) + English letters, spaces and ZWNJ — 2..100 chars. */
const NAME_REGEX = /^[\u0600-\u06FF\u200ca-zA-Z\s]{2,100}$/;
const MOBILE_REGEX = /^09\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const registerSchema = z
  .object({
    firstName: z.string().regex(NAME_REGEX, 'نام معتبر نیست.'),
    lastName: z.string().regex(NAME_REGEX, 'نام خانوادگی معتبر نیست.'),
    mobile: z.string().transform(normalizeMobile).refine((v) => MOBILE_REGEX.test(v), 'شماره موبایل معتبر نیست.'),
    email: z.string().regex(EMAIL_REGEX, 'ایمیل معتبر نیست.').max(190),
    businessName: z.string().trim().min(2, 'نام کسب‌وکار الزامی است.').max(190),
    businessType: z.string().trim().min(2, 'نوع فعالیت کسب‌وکار الزامی است.').max(100),
    password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد.').max(128),
    passwordConfirm: z.string(),
    acceptedTerms: z.literal(true, { errorMap: () => ({ message: 'پذیرش قوانین الزامی است.' }) }),
    referralCode: z.string().trim().max(16).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.password !== data.passwordConfirm) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['passwordConfirm'], message: 'رمز عبور و تکرار آن یکسان نیست.' });
    }
  });

const loginSchema = z
  .object({
    mobile: z.string().optional(),
    email: z.string().optional(),
    password: z.string().min(1, 'رمز عبور الزامی است.'),
  })
  .strict()
  .refine((d) => (d.mobile !== undefined && d.mobile.length > 0) || (d.email !== undefined && d.email.length > 0), {
    message: 'شماره موبایل یا ایمیل الزامی است.',
  });

const passwordResetSchema = z
  .object({
    mobile: z.string().optional(),
    email: z.string().optional(),
  })
  .strict()
  .refine((d) => (d.mobile !== undefined && d.mobile.length > 0) || (d.email !== undefined && d.email.length > 0), {
    message: 'شماره موبایل یا ایمیل الزامی است.',
  });

const passwordResetConfirmSchema = z
  .object({
    token: z.string().min(10),
    password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد.').max(128),
  })
  .strict();

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.').max(128),
  })
  .strict();

function bodyOf<T>(schema: z.ZodType<T>, req: FastifyRequest): T {
  return schema.parse(req.body);
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/register', { ...authLimiter }, async (request, reply) => {
    const input = bodyOf(registerSchema, request);
    const result = await registerUser(
      {
        firstName: input.firstName,
        lastName: input.lastName,
        mobile: input.mobile,
        email: input.email,
        businessName: input.businessName,
        businessType: input.businessType,
        password: input.password,
        referralCode: input.referralCode,
      },
      request,
    );
    SessionService.setSessionCookie(reply, result.sessionToken);
    return sendCreated(reply, {
      user: { id: result.userId, role: result.role },
      referralCode: result.referralCode,
    });
  });

  app.post('/api/v1/auth/login', { ...authLimiter }, async (request, reply) => {
    const input = bodyOf(loginSchema, request);
    const result = await loginUser({ mobile: input.mobile, email: input.email, password: input.password }, request);
    SessionService.setSessionCookie(reply, result.token);
    return sendOk(reply, { user: { id: result.userId, role: result.role } });
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    await logoutUser(token);
    SessionService.clearSessionCookie(reply);
    return sendOk(reply, { ok: true });
  });

  app.post('/api/v1/auth/password-reset', { ...authLimiter }, async (request, reply) => {
    const input = bodyOf(passwordResetSchema, request);
    await requestPasswordReset({ mobile: input.mobile, email: input.email });
    // Generic response — never disclose account existence.
    return sendOk(reply, { message: 'اگر حساب وجود داشته باشد، پیام ارسال می‌شود.' });
  });

  app.post('/api/v1/auth/password-reset/confirm', { ...authLimiter }, async (request, reply) => {
    const input = bodyOf(passwordResetConfirmSchema, request);
    await confirmPasswordReset(input.token, input.password);
    return sendOk(reply, { message: 'رمز عبور با موفقیت تغییر کرد. اکنون می‌توانید وارد شوید.' });
  });

  app.get('/api/v1/me', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.currentUser;
    if (user === undefined) throw validationError('برای ادامه باید وارد حساب خود شوید.');
    const summary = await getMeSummary(user.id);
    return sendOk(reply, summary);
  });

  app.post('/api/v1/auth/change-password', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.currentUser;
    if (user === undefined) throw validationError('برای ادامه باید وارد حساب خود شوید.');
    const input = bodyOf(changePasswordSchema, request);
    if (input.currentPassword === input.newPassword) {
      throw validationError('رمز عبور جدید باید با رمز فعلی متفاوت باشد.');
    }
    const token = request.cookies[SESSION_COOKIE];
    const resolved = token !== undefined ? await SessionService.resolveSession(token) : null;
    if (resolved === null) throw validationError('نشست شما معتبر نیست. دوباره وارد شوید.');
    await changePassword(user.id, resolved.session.id, input.currentPassword, input.newPassword);
    return sendOk(reply, { message: 'رمز عبور با موفقیت تغییر کرد.' });
  });
}
