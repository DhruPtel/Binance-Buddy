// =============================================================================
// resolve_contract — Find and verify BSC contract addresses for protocols/tokens
//
// Resolution chain:
//   1. DeFiLlama pool cache — match protocol slug, extract underlyingTokens
//   2. Brave Search fallback — "{protocol} BSC contract address site:bscscan.com"
//   3. On-chain verification — call symbol() and decimals() to confirm it's a real token
// =============================================================================

import { Contract } from 'ethers';
import type { AgentTool, AgentContext } from '@binancebuddy/core';
import { resolveToken } from '@binancebuddy/core';
import { createProvider, ERC20_ABI } from '@binancebuddy/blockchain';
import { fetchYieldPools } from '../data/defillama.js';
import { searchWeb } from '../data/brave-search.js';

// Match 0x followed by 40 hex characters
const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;

/**
 * Step 1: Search DeFiLlama pools cache for a protocol slug.
 * Returns unique token addresses found in matching pools.
 */
async function searchDefiLlama(
  protocol: string,
  tokenHint?: string,
): Promise<string[]> {
  try {
    const pools = await fetchYieldPools();
    const slugLower = protocol.toLowerCase();
    const matching = pools.filter((p) => p.project.toLowerCase() === slugLower);

    if (matching.length === 0) return [];

    // If a token hint is given, prefer pools whose symbol contains it
    const hintUpper = tokenHint?.toUpperCase();
    const preferred = hintUpper
      ? matching.filter((p) => p.symbol.toUpperCase().includes(hintUpper))
      : matching;

    const source = preferred.length > 0 ? preferred : matching;

    // Collect unique underlying token addresses
    const addresses = new Set<string>();
    for (const pool of source) {
      if (pool.underlyingTokens) {
        for (const addr of pool.underlyingTokens) {
          if (addr && addr.startsWith('0x') && addr.length === 42) {
            addresses.add(addr);
          }
        }
      }
    }
    return [...addresses];
  } catch {
    return [];
  }
}

/**
 * Step 2: Search Brave for BSCScan contract addresses.
 * Parses 0x addresses from search result URLs and descriptions.
 */
async function searchBrave(protocol: string, token?: string): Promise<string[]> {
  const query = token
    ? `${protocol} ${token} BSC contract address site:bscscan.com`
    : `${protocol} BSC contract address site:bscscan.com`;

  const results = await searchWeb(query, 5);
  if (results.length === 0) return [];

  const addresses = new Set<string>();
  for (const result of results) {
    // Extract addresses from URLs (bscscan.com/address/0x... or /token/0x...)
    const urlMatches = result.url.match(ADDRESS_RE);
    if (urlMatches) {
      for (const addr of urlMatches) addresses.add(addr);
    }
    // Also check description text
    const descMatches = result.description.match(ADDRESS_RE);
    if (descMatches) {
      for (const addr of descMatches) addresses.add(addr);
    }
  }
  return [...addresses];
}

/**
 * Step 3: Verify an address on-chain by calling symbol() and decimals().
 */
async function verifyOnChain(
  address: string,
): Promise<{ verified: boolean; symbol?: string; decimals?: number }> {
  try {
    const provider = createProvider();
    const contract = new Contract(address, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      contract.symbol() as Promise<string>,
      contract.decimals() as Promise<bigint>,
    ]);
    return { verified: true, symbol, decimals: Number(decimals) };
  } catch {
    return { verified: false };
  }
}

export const resolveContractTool: AgentTool = {
  name: 'resolve_contract',
  description:
    'Find and verify BSC contract addresses for a protocol or token. ' +
    'Searches DeFiLlama pools, falls back to Brave web search, then verifies on-chain. ' +
    'Call this when you need a contract address for a protocol or token you don\'t recognize.',
  parameters: {
    type: 'object',
    properties: {
      protocol: {
        type: 'string',
        description: 'Protocol slug or name (e.g. "venus-core-pool", "pancakeswap-amm-v2", "radiant-v2")',
      },
      token: {
        type: 'string',
        description: 'Optional token symbol to narrow the search (e.g. "USDT", "CAKE")',
      },
    },
    required: ['protocol'],
  },
  handler: async (params: Record<string, unknown>, _context: AgentContext) => {
    const protocol = String(params.protocol ?? '');
    const token = params.token ? String(params.token) : undefined;

    if (!protocol) {
      return { error: 'Protocol name or slug is required.' };
    }

    // If the token is already known via SAFE_TOKENS, return immediately
    if (token) {
      const known = resolveToken(token);
      if (known) {
        const verification = await verifyOnChain(known);
        return {
          source: 'safe_tokens',
          tokenAddress: known,
          tokenSymbol: verification.symbol ?? token.toUpperCase(),
          tokenDecimals: verification.decimals,
          protocolSlug: protocol,
          verified: verification.verified,
        };
      }
    }

    // Step 1: Search DeFiLlama pools
    const dlAddresses = await searchDefiLlama(protocol, token);
    if (dlAddresses.length > 0) {
      // Verify the first candidate on-chain
      const candidate = dlAddresses[0];
      const verification = await verifyOnChain(candidate);

      return {
        source: 'defillama',
        tokenAddress: candidate,
        tokenSymbol: verification.symbol,
        tokenDecimals: verification.decimals,
        allAddressesFound: dlAddresses.slice(0, 5),
        protocolSlug: protocol,
        verified: verification.verified,
      };
    }

    // Step 2: Brave Search fallback
    const braveAddresses = await searchBrave(protocol, token);
    if (braveAddresses.length > 0) {
      const candidate = braveAddresses[0];
      const verification = await verifyOnChain(candidate);

      return {
        source: 'brave_search',
        tokenAddress: candidate,
        tokenSymbol: verification.symbol,
        tokenDecimals: verification.decimals,
        allAddressesFound: braveAddresses.slice(0, 5),
        protocolSlug: protocol,
        verified: verification.verified,
      };
    }

    return {
      source: 'none',
      tokenAddress: null,
      protocolSlug: protocol,
      verified: false,
      error: `Could not find contract addresses for "${protocol}"${token ? ` / ${token}` : ''}. Try a more specific protocol slug from DeFiLlama.`,
    };
  },
};
