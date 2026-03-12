// =============================================================================
// @binancebuddy/telegram — Telegram Bot (grammy)
// Provides Telegram interface for Binance Buddy.
// OpenClaw handles conversation flow; this handles slash commands.
// =============================================================================

import { Bot, webhookCallback } from 'grammy';
import { registerStart } from './commands/start.js';
import { registerStatus } from './commands/status.js';
import { registerSwap } from './commands/swap.js';
import { registerBuddy } from './commands/buddy.js';

// ---------------------------------------------------------------------------
// WalletStore — maps Telegram userId → BSC wallet address
// Simple in-memory store. In production, persist to Redis or SQLite.
// ---------------------------------------------------------------------------

export type WalletStore = Map<number, string>;

const walletStore: WalletStore = new Map();

// ---------------------------------------------------------------------------
// Bot factory
// ---------------------------------------------------------------------------

let _bot: Bot | null = null;

/**
 * Create and configure the grammy Bot instance.
 * Does NOT start polling — call startPolling() or use webhookHandler().
 */
export function createBot(token: string, serverUrl: string): Bot {
  const bot = new Bot(token);

  // ── Register commands ────────────────────────────────────────────────
  registerStart(bot, walletStore);
  registerStatus(bot, walletStore, serverUrl);
  registerSwap(bot, walletStore, serverUrl);
  registerBuddy(bot);

  // ── Fallback: plain text messages → pass to agent via /api/chat ──────
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const text = ctx.message.text;

    // Check if it looks like a wallet address — auto-link
    if (/^0x[0-9a-fA-F]{40}$/.test(text.trim())) {
      walletStore.set(userId, text.trim());
      await ctx.reply(
        `✅ Wallet linked: \`${text.trim()}\`\n\nUse /status to see your portfolio.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    // Forward to AI agent
    const address = walletStore.get(userId);
    try {
      const res = await fetch(`${serverUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, walletAddress: address }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        await ctx.reply('⚠️ Buddy is taking a nap. Try again in a moment.');
        return;
      }

      const data = (await res.json()) as { reply: string };
      await ctx.reply(data.reply, { parse_mode: 'Markdown' }).catch(() =>
        // Fallback if markdown parsing fails
        ctx.reply(data.reply),
      );
    } catch {
      await ctx.reply('⚠️ Buddy is offline. Make sure the server is running.');
    }
  });

  // ── Error handler ────────────────────────────────────────────────────
  bot.catch((err) => {
    console.error('[Telegram Bot Error]', err.error);
  });

  _bot = bot;
  return bot;
}

/**
 * Start the bot in long-polling mode (for development / no public URL).
 */
export async function startPolling(token: string, serverUrl: string): Promise<Bot> {
  const bot = createBot(token, serverUrl);

  // Set bot commands menu
  await bot.api.setMyCommands([
    { command: 'start', description: 'Welcome & wallet info' },
    { command: 'link', description: 'Link your BSC wallet' },
    { command: 'status', description: 'Portfolio overview' },
    { command: 'swap', description: 'Quick token swap' },
    { command: 'buddy', description: 'Buddy stats & mood' },
  ]);

  await bot.start({
    onStart: (info) => {
      console.log(`[Telegram] Bot @${info.username} started (polling)`);
    },
  });

  return bot;
}

/**
 * Returns an Express-compatible webhook handler.
 * Use this when deploying with a public HTTPS URL.
 */
export function getWebhookHandler(token: string, serverUrl: string) {
  const bot = _bot ?? createBot(token, serverUrl);
  return webhookCallback(bot, 'express');
}

/**
 * Set the webhook URL with Telegram.
 */
export async function setWebhook(token: string, webhookUrl: string): Promise<void> {
  const bot = new Bot(token);
  await bot.api.setWebhook(webhookUrl);
  console.log(`[Telegram] Webhook set to ${webhookUrl}`);
}

/**
 * Stop the bot if it's running.
 */
export async function stopBot(): Promise<void> {
  if (_bot) {
    await _bot.stop();
    _bot = null;
  }
}

export { walletStore };
