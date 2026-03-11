// =============================================================================
// Mood — state machine driven by portfolio performance and interaction recency
// =============================================================================

import type { BuddyState, Mood, WalletState } from '@binancebuddy/core';

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// ---------------------------------------------------------------------------
// Derive mood from portfolio state and interaction recency
// ---------------------------------------------------------------------------

export interface MoodInput {
  walletState: WalletState;
  previousTotalValueUsd?: number; // from last scan, for % change
  lastInteraction: number;        // unix timestamp (ms)
  streakDays: number;
}

export function deriveMood(input: MoodInput): { mood: Mood; reason: string } {
  const now = Date.now();
  const msSinceInteraction = now - input.lastInteraction;

  // Abandoned — no interaction for 2+ days → anxious
  if (msSinceInteraction > 2 * ONE_DAY_MS) {
    return { mood: 'anxious', reason: "You've been gone for a while... I missed you." };
  }

  // Ignored — no interaction for 24h → worried
  if (msSinceInteraction > ONE_DAY_MS) {
    return { mood: 'worried', reason: "Haven't heard from you in a while. Everything okay?" };
  }

  // Portfolio performance check
  if (input.previousTotalValueUsd !== undefined && input.previousTotalValueUsd > 0) {
    const change = (input.walletState.totalValueUsd - input.previousTotalValueUsd) / input.previousTotalValueUsd;

    if (change >= 0.05) {
      return { mood: 'ecstatic', reason: `Portfolio is up ${(change * 100).toFixed(1)}%! Let's go! 🚀` };
    }
    if (change >= 0.01) {
      return { mood: 'happy', reason: `Up ${(change * 100).toFixed(1)}% — solid gains.` };
    }
    if (change <= -0.10) {
      return { mood: 'anxious', reason: `Down ${(Math.abs(change) * 100).toFixed(1)}%... I'm watching the markets closely.` };
    }
    if (change <= -0.03) {
      return { mood: 'worried', reason: `Down ${(Math.abs(change) * 100).toFixed(1)}%. Should we reassess?` };
    }
  }

  // Streak bonus
  if (input.streakDays >= 7) {
    return { mood: 'happy', reason: `${input.streakDays}-day streak! Consistency pays off.` };
  }

  // Default: recent interaction → neutral/happy based on portfolio size
  if (input.walletState.totalValueUsd > 100) {
    return { mood: 'happy', reason: 'Markets are moving. Ready to help.' };
  }

  return { mood: 'neutral', reason: "Watching the chain. What are we doing today?" };
}

// ---------------------------------------------------------------------------
// Apply mood update to state
// ---------------------------------------------------------------------------

export function applyMood(state: BuddyState, input: MoodInput): BuddyState {
  const { mood, reason } = deriveMood(input);
  return {
    ...state,
    mood,
    moodReason: reason,
  };
}

// ---------------------------------------------------------------------------
// Mood → emoji for UI display
// ---------------------------------------------------------------------------

export const MOOD_EMOJI: Record<Mood, string> = {
  ecstatic: '🤩',
  happy: '😊',
  neutral: '😐',
  worried: '😟',
  anxious: '😰',
};

export const MOOD_COLOR: Record<Mood, string> = {
  ecstatic: '#FFD700',
  happy: '#4CAF50',
  neutral: '#9E9E9E',
  worried: '#FF9800',
  anxious: '#F44336',
};
