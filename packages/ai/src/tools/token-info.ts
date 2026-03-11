// =============================================================================
// get_token_info — price and metadata for a token by symbol or address
// =============================================================================

import type { AgentTool, AgentContext } from '@binancebuddy/core';
import { SAFE_TOKENS, COINGECKO_API_URL } from '@binancebuddy/core';

export const getTokenInfoTool: AgentTool = {
  name: 'get_token_info',
  description:
    'Look up current price and metadata for a BSC token by symbol or contract address. ' +
    'Returns price, 24h change, market cap, and basic token info. ' +
    'Use before recommending a swap to get accurate pricing.',
  parameters: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description: 'Token symbol (e.g. "CAKE", "BNB") or contract address (0x...)',
      },
    },
    required: ['token'],
  },
  handler: async (params: Record<string, unknown>, _context: AgentContext) => {
    const token = String(params.token ?? '').trim();

    // BNB is native — use its CoinGecko ID directly
    if (token.toUpperCase() === 'BNB' || token.toUpperCase() === 'WBNB') {
      return fetchCoinGeckoById('binancecoin', 'BNB');
    }

    // Resolve symbol → address
    let address = token.startsWith('0x') ? token.toLowerCase() : null;
    if (!address) {
      const upper = token.toUpperCase();
      const found = SAFE_TOKENS[upper];
      if (found) address = found.toLowerCase();
    }

    if (!address) {
      return { error: `Unknown token: ${token}. Provide a contract address or a known symbol (CAKE, USDT, etc.)` };
    }

    // First check if it's in the wallet context (already have price)
    // Then fall back to CoinGecko
    return fetchCoinGeckoBscToken(address, token.toUpperCase());
  },
};

async function fetchCoinGeckoById(id: string, symbol: string): Promise<unknown> {
  try {
    const url = `${COINGECKO_API_URL}/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    const res = await fetch(url);
    const json = (await res.json()) as Record<string, Record<string, number>>;
    const data = json[id];
    if (!data) return { error: 'CoinGecko returned no data' };
    return {
      symbol,
      priceUsd: data['usd'],
      change24h: data['usd_24h_change'],
      marketCapUsd: data['usd_market_cap'],
      source: 'coingecko',
    };
  } catch {
    return { error: 'Failed to fetch price from CoinGecko' };
  }
}

async function fetchCoinGeckoBscToken(address: string, symbol: string): Promise<unknown> {
  try {
    const url = `${COINGECKO_API_URL}/simple/token_price/binance-smart-chain?contract_addresses=${address}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    const res = await fetch(url);
    const json = (await res.json()) as Record<string, Record<string, number>>;
    const data = json[address.toLowerCase()];
    if (!data || !data['usd']) {
      return { error: `No price data for ${symbol} (${address}). Token may not be tracked by CoinGecko.` };
    }
    return {
      symbol,
      address,
      priceUsd: data['usd'],
      change24h: data['usd_24h_change'],
      marketCapUsd: data['usd_market_cap'],
      source: 'coingecko',
    };
  } catch {
    return { error: 'Failed to fetch token price from CoinGecko' };
  }
}
