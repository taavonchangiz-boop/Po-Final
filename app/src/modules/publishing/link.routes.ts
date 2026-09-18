/**
 * Public click tracker: GET /r/:code -> 302 to the STORED url only (never to a
 * request-supplied target — open-redirect safe), click count incremented
 * asynchronously, analytics event emitted fire-and-forget. Unknown/expired
 * codes redirect to the app root.
 */
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AnalyticsService } from '../../core/events.js';
import { logger } from '../../core/logger.js';
import { db } from '../../db/client.js';
import { linkTargets } from '../../db/schema.js';

const paramsSchema = z.object({ code: z.string().min(1).max(16).regex(/^[0-9a-f]+$/, 'invalid') });

export async function registerLinkRoutes(app: FastifyInstance): Promise<void> {
  app.get('/r/:code', async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.redirect(env.APP_URL, 302);
    }
    const rows = await db
      .select({
        id: linkTargets.id,
        userId: linkTargets.userId,
        postId: linkTargets.postId,
        channelId: linkTargets.channelId,
        url: linkTargets.url,
      })
      .from(linkTargets)
      .where(eq(linkTargets.code, parsed.data.code))
      .limit(1);
    const link = rows[0];
    if (link === undefined) {
      return reply.redirect(env.APP_URL, 302);
    }

    // Async increment (never blocks the redirect; failures are logged only).
    db.update(linkTargets)
      .set({ clickCount: sql`${linkTargets.clickCount} + 1` })
      .where(eq(linkTargets.id, link.id))
      .catch((err: unknown) => {
        logger.warn('link_click_increment_failed', { linkId: link.id, error: err instanceof Error ? err.message : String(err) });
      });

    AnalyticsService.trackEvent({
      userId: link.userId,
      type: 'link.clicked',
      subjectType: 'link',
      subjectId: link.id,
      data: { postId: link.postId, channelId: link.channelId },
    });

    return reply.redirect(link.url, 302);
  });
}
