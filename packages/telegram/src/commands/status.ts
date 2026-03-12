// =============================================================================
// /status — portfolio overview
// =============================================================================

import type { CommandContext, Context } from 'grammy';
import type { WalletStore } from '../bot.js';

interface TokenInfo {
  symbol: string;
  balanceFormatted: number;
  valueUsd: number;
}

interface WalletState {
  bnbBalanceFormatted: number;
  totalValueUsd: number;
  tokens: TokenInfo[];
}

interface UserProfile {
  archetype: string;
  riskScore: number;
  tradingFrequency: string;
  totalTxCount: number;
}

interface ScanResponse {
  walletState: WalletState;
  profile: UserProfile;
}

export function registerStatus(
  bot: { command: (cmd: string, handler: (ctx: CommandContext<Context>) => Promise<void>) => void },
  walletStore: WalletStore,
  serverUrl: string,
): void {
  bot.command('status', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const address = walletStore.get(userId);
    if (!address) {
      await ctx.reply(
        '⚠️ No wallet linked. Use /link <address> to get started.',
      );
      return;
    }

    const loadingMsg = await ctx.reply('🔍 Scanning wallet...');

    try {
      const res = await fetch(`${serverUrl}/api/scan/${address}`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const data = (await res.json()) as ScanResponse;
      const { walletState: ws, profile: p } = data;

      // Build token summary (top 5 by value)
      const topTokens = [...ws.tokens]
        .sort((a, b) => b.valueUsd - a.valueUsd)
        .slice(0, 5);

      let tokenLines = '';
      for (const t of topTokens) {
        if (t.valueUsd < 0.01) continue;
        tokenLines += `  • ${t.symbol}: ${t.balanceFormatted.toFixed(4)} ($${t.valueUsd.toFixed(2)})\n`;
      }
      if (!tokenLines) tokenLines = '  (no tokens with value > $0.01)\n';

      const archEmoji: Record<string, string> = {
        newcomer: '🌱', holder: '💎', swapper: '🔄',
        farmer: '🌾', degen: '🎰', unknown: '❓',
      };

      const reply =
        `📊 *Portfolio Overview*\n` +
        `\`${address.slice(0, 6)}...${address.slice(-4)}\`\n\n` +
        `💰 Total: *$${ws.totalValueUsd.toFixed(2)}*\n` +
        `🟡 BNB: ${ws.bnbBalanceFormatted.toFixed(4)} BNB\n\n` +
        `*Top Holdings:*\n${tokenLines}\n` +
        `🧬 Archetype: ${archEmoji[p.archetype] ?? '❓'} ${p.archetype}\n` +
        `⚡ Risk Score: ${p.riskScore}/10\n` +
        `📈 Frequency: ${p.tradingFrequency}\n` +
        `🔢 Total TXs: ${p.totalTxCount}`;

      await ctx.api.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        reply,
        { parse_mode: 'Markdown' },
      );
    } catch (e) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        `❌ Failed to scan wallet: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });
}
