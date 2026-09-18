/**
 * Central route registry — the ONLY place where module routes are mounted.
 * Modules expose `registerXRoutes(app)`; no module edits buildApp.ts or this file.
 */
import type { FastifyInstance } from 'fastify';

import { registerAuthRoutes } from '../modules/auth/auth.routes.js';
import { registerUserRoutes } from '../modules/users/users.routes.js';
import { registerChannelRoutes } from '../modules/channels/channels.routes.js';
import { registerPublishingRoutes } from '../modules/publishing/publishing.routes.js';
import { registerLinkRoutes } from '../modules/publishing/link.routes.js';
import { registerBotRoutes } from '../modules/bots/bots.routes.js';
import { registerWorkflowRoutes } from '../modules/workflows/workflows.routes.js';
import { registerAiRoutes } from '../modules/ai/ai.routes.js';
import { registerGoldRoutes } from '../modules/gold/gold.routes.js';
import { registerWordpressRoutes } from '../modules/wordpress/wordpress.routes.js';
import { registerBillingRoutes } from '../modules/billing/billing.routes.js';
import { registerNotificationRoutes } from '../modules/notifications/notifications.routes.js';
import { registerAnalyticsRoutes } from '../modules/analytics/analytics.routes.js';
import { registerMediaRoutes } from '../modules/media/media.routes.js';
import { registerSupportRoutes } from '../modules/support/support.routes.js';
import { registerAdminRoutes } from '../modules/admin/admin.routes.js';

export function registerRoutes(app: FastifyInstance): void {
  registerAuthRoutes(app);
  registerUserRoutes(app);
  registerChannelRoutes(app);
  registerPublishingRoutes(app);
  registerLinkRoutes(app);
  registerBotRoutes(app);
  registerWorkflowRoutes(app);
  registerAiRoutes(app);
  registerGoldRoutes(app);
  registerWordpressRoutes(app);
  registerBillingRoutes(app);
  registerNotificationRoutes(app);
  registerAnalyticsRoutes(app);
  registerMediaRoutes(app);
  registerSupportRoutes(app);
  registerAdminRoutes(app);
}
