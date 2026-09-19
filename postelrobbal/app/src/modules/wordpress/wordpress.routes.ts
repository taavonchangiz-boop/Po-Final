import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ERR } from '../../core/errors.js';
import { parseWith } from '../../core/validation.js';
import {
  connectSite,
  listSites,
  deleteSite,
  updateSiteSettings,
  rotateSecret,
  verifySiteRequest,
  syncProducts,
  publishProduct,
  listProducts,
  type WpProductInput,
  type VerifiedSite,
} from './wordpress.service.js';

function auth(req: FastifyRequest): { id: string } {
  if (!req.user) throw new AppError(ERR.AUTH_REQUIRED());
  return { id: req.user.id };
}

const connectSchema = z.object({
  siteUrl: z.string().min(4).max(255),
});

const productSchema = z.object({
  wc_id: z.coerce.number().int().min(1),
  title: z.string().min(1).max(255),
  price_rial: z.coerce.number().int().min(0).nullable().optional(),
  permalink: z.string().max(255).nullable().optional(),
  image_url: z.string().max(512).nullable().optional(),
});

const webhookSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync_products'), products: z.array(productSchema).min(1).max(200) }),
  z.object({ action: z.literal('publish_product'), product: productSchema }),
]);

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return parseWith(schema, body);
}

function fail(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, status: number, code: string, message: string): unknown {
  return reply.code(status).send({ success: false, error: { code, message } });
}

export async function registerWordpressRoutes(app: FastifyInstance): Promise<void> {
  // ---- tenant-facing (requireAuth) ----

  app.post('/wordpress/sites', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const input = parse(connectSchema, req.body);
    const site = await connectSite(me.id, input.siteUrl);
    // The secret is returned exactly once and never stored in plaintext.
    return { success: true, data: { site: { id: site.id, siteUrl: site.siteUrl, siteKey: site.siteKey }, secret: site.secret } };
  });

  app.get('/wordpress/sites', { preHandler: [app.requireAuth] }, async (req) => {
    const sites = await listSites(auth(req).id);
    return { success: true, data: { sites } };
  });

  app.delete('/wordpress/sites/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const { id } = req.params as { id: string };
    await deleteSite(me.id, id);
    return { success: true, data: { ok: true } };
  });

  app.put('/wordpress/sites/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const { id } = req.params as { id: string };
    const input = parse(z.object({ autoPublish: z.boolean() }), req.body);
    const site = await updateSiteSettings(me.id, id, input.autoPublish);
    return { success: true, data: { site } };
  });

  app.post('/wordpress/sites/:id/rotate-secret', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const { id } = req.params as { id: string };
    const data = await rotateSecret(me.id, id);
    return { success: true, data };
  });

  app.get('/wordpress/products', { preHandler: [app.requireAuth] }, async (req) => {
    const me = auth(req);
    const q = (req.query ?? {}) as { page?: string; pageSize?: string };
    const page = Number.parseInt(q.page ?? '1', 10) || 1;
    const pageSize = Number.parseInt(q.pageSize ?? '20', 10) || 20;
    const data = await listProducts(me.id, page, pageSize);
    return { success: true, data };
  });

  // ---- WordPress plugin webhook (PUBLIC, CSRF-exempt via /webhooks prefix) ----

  app.post('/webhooks/wordpress', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const headers = req.headers;
    const siteKey = typeof headers['x-postyar-site-key'] === 'string' ? headers['x-postyar-site-key'] : '';
    const secret = typeof headers['x-postyar-secret'] === 'string' ? headers['x-postyar-secret'] : '';

    const site: VerifiedSite | null = await verifySiteRequest(siteKey, secret);
    if (!site) {
      return fail(reply, 401, 'UNAUTHORIZED', 'اعتبارنامهٔ سایت معتبر نیست.');
    }

    let payload: z.infer<typeof webhookSchema>;
    try {
      payload = parse(webhookSchema, req.body);
    } catch (err) {
      if (err instanceof AppError) return fail(reply, 422, err.code, err.userMessage);
      throw err;
    }

    if (payload.action === 'sync_products') {
      const result = await syncProducts(site, payload.products as WpProductInput[]);
      return { success: true, data: { action: 'sync_products', ...result } };
    }

    const result = await publishProduct(site, payload.product as WpProductInput);
    return { success: true, data: { action: 'publish_product', postId: result.postId, channels: result.channels } };
  });
}
