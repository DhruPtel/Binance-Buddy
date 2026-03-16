// =============================================================================
// get_research — Fetch current DeFi research data for agent decision-making
// Returns top protocols and pools across lending, liquidity, yield categories.
// Optionally deep-dives into a single protocol.
// =============================================================================

import type { AgentTool, AgentContext, ProtocolCategory } from '@binancebuddy/core';
import { researchCategory, researchProtocol } from '../research.js';

const CATEGORIES: ProtocolCategory[] = ['lending', 'liquidity', 'yield'];

export const getResearchTool: AgentTool = {
  name: 'get_research',
  description:
    'Fetch current DeFi research data from BSC protocols. ' +
    'Without a slug, returns the top 3 protocols per category (lending, liquidity, yield) ' +
    'with their best pools, APYs, TVL, and token addresses. ' +
    'With a protocol slug, returns a full deep dive with pool details and strategy brief. ' +
    'ALWAYS call this before recommending investments — never make up APY numbers.',
  parameters: {
    type: 'object',
    properties: {
      protocolSlug: {
        type: 'string',
        description: 'Optional protocol slug (e.g. "venus-core-pool", "pancakeswap-amm-v2") for a single protocol deep dive.',
      },
    },
    required: [],
  },
  handler: async (params: Record<string, unknown>, context: AgentContext) => {
    const slug = params.protocolSlug ? String(params.protocolSlug) : null;

    // Single protocol deep dive
    if (slug) {
      try {
        const report = await researchProtocol(slug, context.userProfile);
        return {
          mode: 'deep_dive',
          protocol: {
            name: report.protocolName,
            slug: report.protocolSlug,
            category: report.category,
            tvlUsd: report.tvlUsd,
            volume24h: report.volume24h,
            fees24h: report.fees24h,
            revenue24h: report.revenue24h,
          },
          pools: report.pools.map((p) => ({
            symbol: p.symbol,
            apy: p.apy,
            apyBase: p.apyBase,
            apyReward: p.apyReward,
            tvlUsd: p.tvlUsd,
            poolType: p.poolType,
            ilRisk: p.ilRisk,
            underlyingTokens: p.underlyingTokens,
            isHighlighted: p.isHighlighted,
          })),
          strategyBrief: report.strategyBrief,
          risk: report.risk,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `Research failed for ${slug}: ${msg.slice(0, 200)}` };
      }
    }

    // Multi-category overview
    const results: Record<string, unknown> = { mode: 'overview', categories: {} };
    const catResults = results.categories as Record<string, unknown>;

    for (const cat of CATEGORIES) {
      try {
        const summary = await researchCategory(cat);
        const topProtocols = summary.protocols.slice(0, 3).map((proto) => ({
          name: proto.name,
          slug: proto.slug,
          tvlUsd: proto.tvlUsd,
          volume24h: proto.volume24h,
          bestApy: proto.bestApy,
          hasVerifiedPools: proto.hasVerifiedPools,
        }));

        catResults[cat] = {
          protocolCount: summary.protocols.length,
          topProtocols,
          lastUpdated: summary.lastUpdated,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        catResults[cat] = { error: msg.slice(0, 200) };
      }
    }

    return results;
  },
};
