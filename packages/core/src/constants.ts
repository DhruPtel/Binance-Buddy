// =============================================================================
// @binancebuddy/core — Constants
// BSC addresses, guardrail config, safe tokens, BigInt serializer.
// =============================================================================

import type { GuardrailConfig, TradeMode } from './types.js';

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

export const BSC_CHAIN_ID = 56;
export const BSC_TESTNET_CHAIN_ID = 97;

export const BSC_RPC_URLS = {
  mainnet: [
    'https://bsc-dataseed.bnbchain.org',
    'https://bsc-dataseed1.defibit.io',
    'https://bsc-dataseed1.ninicoin.io',
    'https://rpc.ankr.com/bsc',
  ],
  testnet: [
    'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    'https://data-seed-prebsc-2-s1.bnbchain.org:8545',
  ],
} as const;

// ---------------------------------------------------------------------------
// Native Tokens
// ---------------------------------------------------------------------------

export const NATIVE_BNB_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

// ---------------------------------------------------------------------------
// Stablecoins & Safe Tokens
// ---------------------------------------------------------------------------

export const SAFE_TOKENS: Record<string, string> = {
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  ETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  BTCB: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
};

// Reverse map: address (lowercase) → symbol
export const TOKEN_SYMBOL_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(SAFE_TOKENS).map(([symbol, address]) => [address.toLowerCase(), symbol])
);

// ---------------------------------------------------------------------------
// PancakeSwap V2
// ---------------------------------------------------------------------------

export const PANCAKESWAP_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
export const PANCAKESWAP_V2_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';

// ---------------------------------------------------------------------------
// PancakeSwap V3
// ---------------------------------------------------------------------------

export const PANCAKESWAP_V3_ROUTER = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4';
export const PANCAKESWAP_V3_FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
export const PANCAKESWAP_V3_QUOTER = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997';

// ---------------------------------------------------------------------------
// Known Protocol Contract Addresses (BSC Mainnet)
// ---------------------------------------------------------------------------

export const KNOWN_PROTOCOLS: Record<string, { name: string; category: string; addresses: string[] }> = {
  pancakeswap: {
    name: 'PancakeSwap',
    category: 'dex',
    addresses: [
      PANCAKESWAP_V2_ROUTER,
      PANCAKESWAP_V2_FACTORY,
      PANCAKESWAP_V3_ROUTER,
      PANCAKESWAP_V3_FACTORY,
    ],
  },
  venus: {
    name: 'Venus',
    category: 'lending',
    addresses: [
      '0xfD36E2c2a6789Db23113685031d7F16329158384', // Comptroller
      '0xA07c5b74C9B40447a954e1466938b865b6BBea36', // vBNB
      '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8', // vUSDC
    ],
  },
  alpaca: {
    name: 'Alpaca Finance',
    category: 'farming',
    addresses: [
      '0xA625AB01B08ce023B2a342Dbb12a16f2C8489A8F', // FairLaunch
    ],
  },
  thena: {
    name: 'Thena',
    category: 'dex',
    addresses: [
      '0xd4ae6eCA985340Dd434D38F470aCCce4DC78d109', // Router
    ],
  },
};

// Reverse map: address (lowercase) → protocol name
export const ADDRESS_TO_PROTOCOL: Record<string, string> = {};
for (const [, protocol] of Object.entries(KNOWN_PROTOCOLS)) {
  for (const address of protocol.addresses) {
    ADDRESS_TO_PROTOCOL[address.toLowerCase()] = protocol.name;
  }
}

// ---------------------------------------------------------------------------
// Guardrail Constants
// ---------------------------------------------------------------------------

export const GUARDRAIL_CONFIGS: Record<TradeMode, GuardrailConfig> = {
  normal: {
    maxTransactionValueBnb: 1.0,
    maxSlippageBps: 100,       // 1%
    bnbFeeReserve: 0.005,
    circuitBreakerThreshold: 3,
    requireApprovalAboveBnb: 0.5,
  },
  trenches: {
    maxTransactionValueBnb: 2.0,
    maxSlippageBps: 1500,      // 15%
    bnbFeeReserve: 0.005,
    circuitBreakerThreshold: 3,
    requireApprovalAboveBnb: 1.0,
  },
};

// Convenience aliases
export const BNB_FEE_RESERVE = 0.005;
export const MAX_SLIPPAGE_NORMAL_BPS = 100;
export const MAX_SLIPPAGE_TRENCHES_BPS = 1500;
export const CIRCUIT_BREAKER_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Swap / DEX Constants
// ---------------------------------------------------------------------------

export const DEFAULT_DEADLINE_SECONDS = 20 * 60; // 20 minutes
export const DEFAULT_GAS_LIMIT_SWAP = 300_000n;
export const DEFAULT_GAS_LIMIT_APPROVE = 60_000n;

// ---------------------------------------------------------------------------
// Research Agent Constants
// ---------------------------------------------------------------------------

export const RESEARCH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
export const RESEARCH_MIN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes (rate limit)
export const RESEARCH_MAX_RPC_CALLS = 10;
export const RESEARCH_MAX_API_CALLS = 3;

// ---------------------------------------------------------------------------
// Buddy / XP Constants
// ---------------------------------------------------------------------------

export const XP_REWARDS: Record<string, number> = {
  trade_executed: 10,
  profitable_trade: 15,
  daily_checkin: 5,
  wallet_scan: 3,
  chat_interaction: 1,
  farm_entered: 12,
  snipe_success: 25,
  achievement_unlocked: 50,
};

// ---------------------------------------------------------------------------
// Ankr Enhanced API (replaces BSCScan — free tier requires sign-up at ankr.com)
// ---------------------------------------------------------------------------

// JSON-RPC multichain endpoint. Append /{apiKey} when a key is available.
export const ANKR_MULTICHAIN_URL = 'https://rpc.ankr.com/multichain';
export const ANKR_TX_LIMIT = 50; // Ankr pageSize max per request

// ---------------------------------------------------------------------------
// CoinGecko (free tier)
// ---------------------------------------------------------------------------

export const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3';
export const COINGECKO_BNB_ID = 'binancecoin';

// ---------------------------------------------------------------------------
// BigInt JSON Serializer
// ---------------------------------------------------------------------------

/**
 * JSON.stringify replacer that converts BigInt values to strings.
 * Usage: JSON.stringify(obj, bigintReplacer)
 *
 * CRITICAL: BigInt values will throw "TypeError: Do not know how to serialize
 * a BigInt" without this replacer. Use it everywhere you JSON.stringify
 * blockchain data.
 */
export function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Safe JSON.stringify that handles BigInt values automatically.
 * Drop-in replacement for JSON.stringify in blockchain contexts.
 */
export function safeStringify(value: unknown, indent?: number): string {
  return JSON.stringify(value, bigintReplacer, indent);
}

/**
 * Parse a string back to BigInt safely (returns 0n on invalid input).
 */
export function parseBigIntSafe(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
