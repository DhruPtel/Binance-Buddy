// =============================================================================
// /swap — quick swap with inline confirmation buttons
// =============================================================================

import { InlineKeyboard } from 'grammy';
import type { CommandContext, Context, CallbackQueryContext } from 'grammy';
import type { WalletStore } from '../bot.js';

interface ChatResponse {
  reply: string;
  success: boolean;
}

// Pending swap confirmations keyed by userId
const pendingSwaps = new Map<number, { message: string; address: string }>();

export function registerSwap(
  bot: {
    command: (cmd: string, handler: (ctx: CommandContext<Context>) => Promise<void>) => void;
    callbackQuery: (pattern: string | RegExp, handler: (ctx: CallbackQueryContext<Context>) => Promise<void>) => void;
  },
  walletStore: WalletStore,
  serverUrl: string,
): void {
  bot.command('swap', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const address = walletStore.get(userId);
    if (!address) {
      await ctx.reply('⚠️ No wallet linked. Use /link <address> first.');
      return;
    }

    // Parse: /swap 0.1 BNB for CAKE
    const text = ctx.message?.text ?? '';
    const args = text.replace('/swap', '').trim();

    if (!args) {
      await ctx.reply(
        '📝 *Swap Format:*\n`/swap <amount> <tokenIn> for <tokenOut>`\n\nExamples:\n• `/swap 0.1 BNB for CAKE`\n• `/swap 10 USDT for BNB`',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    // Build the agent message
    const agentMessage = `swap ${args}`;
    pendingSwaps.set(userId, { message: agentMessage, address });

    const kb = new InlineKeyboard()
      .text('✅ Confirm Swap', `swap_confirm:${userId}`)
      .text('❌ Cancel', `swap_cancel:${userId}`);

    await ctx.reply(
      `🔄 *Swap Request*\n\n\`${args}\`\n\nThis will ask your Binance Buddy to prepare the swap. You'll see the quote before anything executes.`,
      { parse_mode: 'Markdown', reply_markup: kb },
    );
  });

  bot.callbackQuery(/^swap_confirm:(\d+)$/, async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    const requesterId = ctx.from?.id;

    // Only the requesting user can confirm
    if (requesterId !== userId) {
      await ctx.answerCallbackQuery({ text: 'This is not your swap.', show_alert: true });
      return;
    }

    const pending = pendingSwaps.get(userId);
    if (!pending) {
      await ctx.answerCallbackQuery({ text: 'Swap expired.' });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      return;
    }

    pendingSwaps.delete(userId);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('⏳ Getting swap quote from Buddy...');

    try {
      const res = await fetch(`${serverUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: pending.message,
          walletAddress: pending.address,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const data = (await res.json()) as ChatResponse;

      await ctx.editMessageText(
        `🤖 *Buddy says:*\n\n${data.reply}`,
        { parse_mode: 'Markdown' },
      );
    } catch (e) {
      await ctx.editMessageText(
        `❌ Error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  bot.callbackQuery(/^swap_cancel:(\d+)$/, async (ctx) => {
    const userId = parseInt(ctx.match[1]);
    const requesterId = ctx.from?.id;

    if (requesterId !== userId) {
      await ctx.answerCallbackQuery({ text: 'Not your swap.', show_alert: true });
      return;
    }

    pendingSwaps.delete(userId);
    await ctx.answerCallbackQuery({ text: 'Swap cancelled.' });
    await ctx.editMessageText('❌ Swap cancelled.');
  });
}
