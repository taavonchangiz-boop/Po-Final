/**
 * Provider registry (ADR-009 capability registry).
 * Decryption happens at CALLERS — the registry only receives plaintext tokens
 * in-memory and never logs or persists them.
 */
import { createBaleProvider } from './bale/bale.provider.js';
import { RubikaProvider } from './rubika/rubika.provider.js';
import { createTelegramProvider } from './telegram/telegram.provider.js';
import type { BotProvider, ChannelProvider, ProviderCapabilities, ProviderKind } from './types.js';

const RUBIKA_CAPABILITIES: ProviderCapabilities = {
  sendText: true,
  sendMedia: true,
  editMessage: false,
  deleteMessage: false,
  buttons: true,
  webhookRegistration: false,
  updateRetrieval: true,
  botIdentity: true,
  healthCheck: true,
};

const CAPABILITY_MAP: Record<ProviderKind, ProviderCapabilities> = {
  TELEGRAM: {
    sendText: true,
    sendMedia: true,
    editMessage: true,
    deleteMessage: true,
    buttons: true,
    webhookRegistration: true,
    updateRetrieval: true,
    botIdentity: true,
    healthCheck: true,
  },
  BALE: {
    sendText: true,
    sendMedia: true,
    editMessage: true,
    deleteMessage: true,
    buttons: true,
    // Bale webhook registration works, but Bale does not verify the
    // secret_token header server-side (see bale.provider.ts caveat).
    webhookRegistration: true,
    updateRetrieval: true,
    botIdentity: true,
    healthCheck: true,
  },
  RUBIKA: RUBIKA_CAPABILITIES,
};

function unknownKind(kind: string): never {
  throw new Error(`Unknown provider kind: ${kind}`);
}

/** Channel-side provider for a tenant credential bundle (already decrypted). */
export function getChannelProvider(kind: ProviderKind, creds: { token: string }): ChannelProvider {
  switch (kind) {
    case 'TELEGRAM':
      return createTelegramProvider(creds.token);
    case 'BALE':
      return createBaleProvider(creds.token);
    case 'RUBIKA':
      return new RubikaProvider(creds.token);
    default:
      unknownKind(kind as string);
  }
}

/** Bot-side provider for a bot token (already decrypted). */
export function getBotProvider(kind: ProviderKind, token: string): BotProvider {
  switch (kind) {
    case 'TELEGRAM':
      return createTelegramProvider(token);
    case 'BALE':
      return createBaleProvider(token);
    case 'RUBIKA':
      return new RubikaProvider(token);
    default:
      unknownKind(kind as string);
  }
}

/** Static capability map (UI disables unsupported operations from this). */
export function getCapabilities(kind: ProviderKind): ProviderCapabilities {
  return CAPABILITY_MAP[kind];
}
