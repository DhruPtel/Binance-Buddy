// =============================================================================
// /start — wallet linking flow
// =============================================================================

import type { CommandContext, Context } from 'grammy';
import type { WalletStore } from '../bot.js';

export function registerStart(
  bot: { command: (cmd: string, handler: (ctx: CommandContext<Context>) => Promise<void>) => void },
  walletStore: WalletStore,
): void {
  bot.command('start', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const existing = walletStore.get(userId);

    if (existing) {
      await ctx.reply(
        `👋 Welcome back!\n\n` +
        `Your linked wallet: \`${existing}\`\n\n` +
        `Commands:\n` +
        `/status — portfolio overview\n` +
        `/swap — quick swap\n` +
        `/buddy — buddy stats\n` +
        `/link <address> — change wallet`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    await ctx.reply(
      `🐾 *Welcome to Binance Buddy!*\n\n` +
      `I'm your AI blockchain companion for BNB Chain.\n\n` +
      `To get started, link your BSC wallet address:\n` +
      `/link 0xYourWalletAddress\n\n` +
      `Or send your address directly and I'll link it for you.`,
      { parse_mode: 'Markdown' },
    );
  });

  // /link <address> command
  bot.command('link', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const args = ctx.message?.text?.split(' ') ?? [];
    const address = args[1]?.trim();

    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      await ctx.reply(
        '❌ Invalid address. Please provide a valid BSC address:\n`/link 0x...`',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    walletStore.set(userId, address);
    await ctx.reply(
      `✅ Wallet linked!\n\n` +
      `\`${address}\`\n\n` +
      `Use /status to see your portfolio.`,
      { parse_mode: 'Markdown' },
    );
  });
}
