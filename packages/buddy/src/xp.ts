// =============================================================================
// XP — award and calculate experience points for buddy actions
// =============================================================================

import { XP_REWARDS, XP_THRESHOLDS } from '@binancebuddy/core';
import type { BuddyState, XPSource, EvolutionStage } from '@binancebuddy/core';

// ---------------------------------------------------------------------------
// Award XP
// ---------------------------------------------------------------------------

/**
 * Returns an updated BuddyState with XP added and level recalculated.
 * Does not mutate the input.
 */
export function awardXp(state: BuddyState, source: XPSource): BuddyState {
  const amount = XP_REWARDS[source] ?? 1;
  const newXp = state.xp + amount;
  const newLevel = xpToLevel(newXp);

  return {
    ...state,
    xp: newXp,
    level: newLevel,
    totalInteractions: source === 'chat_interaction'
      ? state.totalInteractions + 1
      : state.totalInteractions,
    totalTradesExecuted: source === 'trade_executed' || source === 'snipe_success'
      ? state.totalTradesExecuted + 1
      : state.totalTradesExecuted,
  };
}

// ---------------------------------------------------------------------------
// XP → level conversion
// ---------------------------------------------------------------------------

/**
 * Derive a numeric level (1-based) from total XP.
 * Levels scale with XP_THRESHOLDS stages, then +1 per 500 XP beyond apex.
 */
export function xpToLevel(xp: number): number {
  const stages: EvolutionStage[] = ['seedling', 'sprout', 'bloom', 'guardian', 'apex'];
  let level = 1;
  for (const stage of stages) {
    if (xp >= XP_THRESHOLDS[stage]) level++;
  }
  // Post-apex: +1 per 500 XP
  const apexXp = XP_THRESHOLDS['apex'];
  if (xp > apexXp) {
    level += Math.floor((xp - apexXp) / 500);
  }
  return level;
}

// ---------------------------------------------------------------------------
// XP progress toward next threshold
// ---------------------------------------------------------------------------

export interface XpProgress {
  current: number;
  nextThreshold: number | null; // null at apex max
  percent: number;              // 0–100
}

export function getXpProgress(xp: number, stage: EvolutionStage): XpProgress {
  const thresholds: [EvolutionStage, number][] = [
    ['seedling', XP_THRESHOLDS.seedling],
    ['sprout', XP_THRESHOLDS.sprout],
    ['bloom', XP_THRESHOLDS.bloom],
    ['guardian', XP_THRESHOLDS.guardian],
    ['apex', XP_THRESHOLDS.apex],
  ];

  const currentIdx = thresholds.findIndex(([s]) => s === stage);
  const currentThreshold = thresholds[currentIdx][1];
  const nextEntry = thresholds[currentIdx + 1];

  if (!nextEntry) {
    // Already at apex — show progress beyond apex in 500 XP increments
    const apexXp = XP_THRESHOLDS.apex;
    const extra = xp - apexXp;
    const blockStart = Math.floor(extra / 500) * 500;
    const blockEnd = blockStart + 500;
    return {
      current: extra - blockStart,
      nextThreshold: blockEnd - blockStart,
      percent: Math.floor(((extra - blockStart) / 500) * 100),
    };
  }

  const nextThreshold = nextEntry[1];
  const inStage = xp - currentThreshold;
  const stageSize = nextThreshold - currentThreshold;

  return {
    current: inStage,
    nextThreshold: stageSize,
    percent: Math.floor((inStage / stageSize) * 100),
  };
}
