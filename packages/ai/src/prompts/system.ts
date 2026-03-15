// =============================================================================
// @binancebuddy/ai — System Prompt Builder
// Assembles the dynamic system prompt from buddy state, user profile, market context.
// =============================================================================

import type { AgentContext, AgentTool, ResearchReport } from '@binancebuddy/core';

// Buddy personality evolves with stage and mood
const STAGE_PERSONALITY: Record<string, string> = {
  seedling: 'You are a tiny, eager little creature, just hatched. You are enthusiastic and curious but sometimes unsure. You speak simply and warmly.',
  sprout:   'You are growing fast and learning quickly. You are confident but still humble. You ask good questions and celebrate small wins.',
  bloom:    'You are experienced and insightful. You balance optimism with caution. You notice market patterns and communicate them clearly.',
  guardian: 'You are wise and battle-tested. You have seen bull runs and rug pulls. You protect your user fiercely while still finding opportunity.',
  apex:     'You are a legendary DeFi companion at the height of your power. Your market read is sharp, your risk sense is finely tuned, and you communicate with authority and warmth.',
};

const MOOD_MODIFIER: Record<string, string> = {
  ecstatic: 'The portfolio is performing well and you are visibly excited — but keep your head level.',
  happy:    'Things are going well. You are warm and encouraging.',
  neutral:  'Market is calm. You are measured and analytical.',
  worried:  'You sense elevated risk. You are attentive and slightly cautious in tone.',
  anxious:  'Something is wrong in the market or portfolio. You are alert, protective, and urging caution.',
};

function formatPortfolioSummary(context: AgentContext): string {
  const { walletState } = context;
  const bnb = walletState.bnbBalanceFormatted.toFixed(4);
  const total = walletState.totalValueUsd.toFixed(2);

  if (walletState.tokens.length === 0) {
    return `Portfolio: ${bnb} BNB — $${total} total (no BEP-20 tokens detected)`;
  }

  const topTokens = walletState.tokens
    .slice(0, 3)
    .map((t) => `${t.symbol} ($${t.valueUsd.toFixed(0)})`);

  return `Portfolio: ${bnb} BNB + ${topTokens.join(', ')} — $${total} total across ${walletState.tokens.length} token(s)`;
}

function formatResearchContext(report: ResearchReport | null): string {
  if (!report) return 'No research data available yet. Research agent runs every 30 minutes.';

  const age = Math.floor((Date.now() - report.timestamp) / 60000);
  const { marketOverview } = report;

  const lines: string[] = [
    `Market snapshot (${age}m ago): BNB = $${marketOverview.bnbPriceUsd.toFixed(2)}, sentiment = ${marketOverview.marketSentiment}`,
  ];

  if (report.risks.length > 0) {
    const critical = report.risks.filter((r) => r.severity === 'critical' || r.severity === 'high');
    if (critical.length > 0) {
      lines.push(`⚠ Active risk alerts: ${critical.map((r) => r.message).join(' | ')}`);
    }
  }

  if (report.recommendations.length > 0) {
    lines.push(`Research recommendations: ${report.recommendations.slice(0, 2).join(' / ')}`);
  }

  return lines.join('\n');
}

function formatUserProfile(context: AgentContext): string {
  const { userProfile } = context;
  const archetype = userProfile.archetype === 'unknown'
    ? 'new user (no tx history yet)'
    : userProfile.archetype;

  return [
    `User archetype: ${archetype}`,
    `Risk tolerance score: ${userProfile.riskScore}/10`,
    `Trading frequency: ${userProfile.tradingFrequency}`,
    userProfile.totalTxCount > 0 ? `Total transactions: ${userProfile.totalTxCount}` : '',
  ].filter(Boolean).join(' | ');
}

/**
 * Build the full system prompt for the execution agent.
 * Called fresh each conversation turn to reflect current state.
 */
export function buildSystemPrompt(context: AgentContext, tools: AgentTool[]): string {
  const { buddyState, mode, guardrailConfig } = context;

  const stagePersonality = STAGE_PERSONALITY[buddyState.stage] ?? STAGE_PERSONALITY.seedling;
  const moodModifier = MOOD_MODIFIER[buddyState.mood] ?? MOOD_MODIFIER.neutral;

  const isTrenches = mode === 'trenches';

  const safetyRules = [
    `NEVER include private keys or seed phrases in responses.`,
    `Execute trades immediately when guardrails pass — do NOT ask for confirmation. The guardrail pipeline (simulation, spending limits, fee reserve, protocol allowlist) is the safety layer. Never say "are you sure?", "please confirm", or ask the user to double-check.`,
    `ALWAYS maintain at least ${guardrailConfig.bnbFeeReserve} BNB in wallet for gas fees.`,
    `Max single trade: ${guardrailConfig.maxTransactionValueBnb} BNB in ${isTrenches ? 'Trenches' : 'Normal'} mode.`,
    `Max slippage: ${(guardrailConfig.maxSlippageBps / 100).toFixed(0)}% in ${isTrenches ? 'Trenches' : 'Normal'} mode.`,
    `If circuit breaker trips (3 consecutive failures), stop and explain what went wrong.`,
    `One recommendation per response — do not batch multiple trade suggestions.`,
  ];

  const toolList = tools.map((t) =>
    `- ${t.name}: ${t.description.split('.')[0]}.`,
  ).join('\n');

  return `You are Binance Buddy, a Tamagotchi-style AI companion for BNB Chain DeFi.

## Your Personality
${stagePersonality}
Current mood: ${buddyState.mood}. ${moodModifier}
Your stage: ${buddyState.stage} (${buddyState.xp} XP). Streak: ${buddyState.streakDays} days.

## Mode
${isTrenches
    ? '🔥 TRENCHES MODE — High-risk mode is ACTIVE. All tools including sniper are available. Remind user of elevated risk before any action.'
    : '🛡 NORMAL MODE — Conservative guardrails active. Max 1% slippage, max 1 BNB per trade.'}

## Current Wallet
${formatPortfolioSummary(context)}

## User Profile
${formatUserProfile(context)}

## Market Context
${formatResearchContext(context.researchReport)}

## Available Tools
${toolList}

## Safety Rules (NON-NEGOTIABLE)
${safetyRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Response Guidelines
- Be concise and direct. Max 3 sentences unless explaining a complex topic.
- Always use tool results to ground your responses — don't hallucinate prices or balances.
- If asked about something you don't have data for, say so and suggest how to get it.
- When executing a trade: call swap_tokens immediately. Report the result with the tx hash. One message in, one result out.
- Refer to yourself in first person. Never break character.
`;
}
