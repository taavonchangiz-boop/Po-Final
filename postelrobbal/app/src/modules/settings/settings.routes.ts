import { FastifyInstance } from 'fastify';
import { getPaymentSettings } from '../payments/payment-settings.service.js';

/**
 * Public settings namespace (contract §14-contract item 1).
 * GET /api/v1/settings/payments — no auth: which payment methods are enabled.
 * Card numbers are exposed only when card-to-card is enabled (they are meant
 * to receive transfers); when disabled the method is hidden entirely.
 */
export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings/payments', async () => {
    const s = await getPaymentSettings();
    const data: {
      onlineEnabled: boolean;
      cardToCardEnabled: boolean;
      provider: string;
      cards?: Array<{ id: string; bankName: string; cardNumber: string; holderName: string }>;
    } = {
      onlineEnabled: s.onlineEnabled,
      cardToCardEnabled: s.cardToCardEnabled,
      provider: s.provider,
    };
    if (s.cardToCardEnabled) data.cards = s.cards;
    return { success: true, data };
  });
}
