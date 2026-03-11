// =============================================================================
// Evolution — stage progression and threshold checks
// =============================================================================

import { XP_THRESHOLDS } from '@binancebuddy/core';
import type { BuddyState, EvolutionStage } from '@binancebuddy/core';

// Ordered stage list
const STAGES: EvolutionStage[] = ['seedling', 'sprout', 'bloom', 'guardian', 'apex'];

// ---------------------------------------------------------------------------
// Derive current stage from XP
// ---------------------------------------------------------------------------

export function xpToStage(xp: number): EvolutionStage {
  // Walk backwards — highest threshold first
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (xp >= XP_THRESHOLDS[STAGES[i]]) {
      return STAGES[i];
    }
  }
  return 'seedling';
}

// ---------------------------------------------------------------------------
// Check if buddy is ready to evolve
// ---------------------------------------------------------------------------

export interface EvolutionCheck {
  readyToEvolve: boolean;
  currentStage: EvolutionStage;
  nextStage: EvolutionStage | null;
  xpRequired: number;
  xpCurrent: number;
}

export function checkEvolution(state: BuddyState): EvolutionCheck {
  const derivedStage = xpToStage(state.xp);
  const currentIdx = STAGES.indexOf(derivedStage);
  const nextStage = currentIdx < STAGES.length - 1 ? STAGES[currentIdx + 1] : null;
  const xpRequired = nextStage ? XP_THRESHOLDS[nextStage] : XP_THRESHOLDS['apex'];
  const readyToEvolve = derivedStage !== state.stage && STAGES.indexOf(derivedStage) > STAGES.indexOf(state.stage);

  return {
    readyToEvolve,
    currentStage: derivedStage,
    nextStage,
    xpRequired,
    xpCurrent: state.xp,
  };
}

// ---------------------------------------------------------------------------
// Apply evolution (call after confirming readyToEvolve)
// ---------------------------------------------------------------------------

export function applyEvolution(state: BuddyState): BuddyState {
  const { currentStage } = checkEvolution(state);

  // Unlock trenches mode at bloom stage
  const trenchesUnlocked = state.trenchesUnlocked ||
    STAGES.indexOf(currentStage) >= STAGES.indexOf('bloom');

  return {
    ...state,
    stage: currentStage,
    trenchesUnlocked,
  };
}

// ---------------------------------------------------------------------------
// Get stage display info
// ---------------------------------------------------------------------------

export interface StageInfo {
  stage: EvolutionStage;
  label: string;
  description: string;
  xpThreshold: number;
  trenchesUnlocked: boolean;
}

export const STAGE_INFO: Record<EvolutionStage, StageInfo> = {
  seedling: {
    stage: 'seedling',
    label: 'Seedling',
    description: 'Just woke up. Learning the ropes.',
    xpThreshold: XP_THRESHOLDS.seedling,
    trenchesUnlocked: false,
  },
  sprout: {
    stage: 'sprout',
    label: 'Sprout',
    description: 'Getting curious. Watching the market.',
    xpThreshold: XP_THRESHOLDS.sprout,
    trenchesUnlocked: false,
  },
  bloom: {
    stage: 'bloom',
    label: 'Bloom',
    description: 'Confident trader. Trenches unlocked.',
    xpThreshold: XP_THRESHOLDS.bloom,
    trenchesUnlocked: true,
  },
  guardian: {
    stage: 'guardian',
    label: 'Guardian',
    description: 'Seasoned DeFi guardian. Sharp instincts.',
    xpThreshold: XP_THRESHOLDS.guardian,
    trenchesUnlocked: true,
  },
  apex: {
    stage: 'apex',
    label: 'Apex',
    description: 'Legend of the chain. Maximum power.',
    xpThreshold: XP_THRESHOLDS.apex,
    trenchesUnlocked: true,
  },
};
