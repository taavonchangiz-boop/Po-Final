import { FastifyInstance } from 'fastify';
import { getPaymentSettings } from '../payments/payment-settings.service.js';
import { getGeneralSettings, getSecuritySettings, getReferralSettings } from '../admin/system-settings.service.js';

/**
 * Public settings namespace (contract §14-contract item 1).
 * GET /api/v1/settings/payments — no auth: which payment methods are enabled.
 * Card numbers are exposed only when card-to-card is enabled (they are meant
 * to receive transfers); when disabled the method is hidden entirely.
 *
 * Round 17 additions — whitelisted, no secrets:
 * GET /settings/general  → site identity + support contacts + maintenance flag
 * GET /settings/security → registrationEnabled / captchaEnabled (AuthModal)
 * GET /settings/referral → registerRewardPoints (referral page)
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

  // Whitelisted fields only — termsNoteFa stays admin-facing.
  app.get('/settings/general', async () => {
    const s = await getGeneralSettings();
    return {
      success: true,
      data: {
        siteNameFa: s.siteNameFa,
        siteTaglineFa: s.siteTaglineFa,
        supportEmail: s.supportEmail,
        supportPhone: s.supportPhone,
        maintenanceEnabled: s.maintenanceEnabled,
        maintenanceMessageFa: s.maintenanceMessageFa,
      },
    };
  });

  app.get('/settings/security', async () => {
    const s = await getSecuritySettings();
    return {
      success: true,
      data: { registrationEnabled: s.registrationEnabled, captchaEnabled: s.captchaEnabled },
    };
  });

  app.get('/settings/referral', async () => {
    const s = await getReferralSettings();
    return { success: true, data: { registerRewardPoints: s.registerRewardPoints } };
  });
}
