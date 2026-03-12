// @binancebuddy/telegram — Telegram bot interface
export {
  createBot,
  startPolling,
  getWebhookHandler,
  setWebhook,
  stopBot,
  walletStore,
} from './bot.js';
export type { WalletStore } from './bot.js';

export { getBuddyForUser, setBuddyForUser } from './commands/buddy.js';
