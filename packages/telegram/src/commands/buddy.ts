// =============================================================================
// /buddy — buddy stats
// =============================================================================

import type { CommandContext, Context } from 'grammy';
import { MOOD_EMOJI, STAGE_INFO } from '@binancebuddy/buddy';
import type { BuddyState } from '@binancebuddy/core';

// Default buddy state for users who haven't started a session yet
const DEFAULT_BUDDY: BuddyState = {
  creatureType: 'creature_a',
  stage: 'seedling',
  xp: 0,
  level: 1,
  mood: 'neutral',
  moodReason: 'just started',
  trenchesUnlocked: false,
  achievements: [],
  lastInteraction: Date.now(),
  totalInteractions: 0,
  totalTradesExecuted: 0,
  streakDays: 0,
};

interface BuddyStoreEntry {
  state: BuddyState;
  updatedAt: number;
}

// In-memory buddy store (persisted state would live in server session)
const buddyStore = new Map<number, BuddyStoreEntry>();

export function getBuddyForUser(userId: number): BuddyState {
  return buddyStore.get(userId)?.state ?? DEFAULT_BUDDY;
}

export function setBuddyForUser(userId: number, state: BuddyState): void {
  buddyStore.set(userId, { state, updatedAt: Date.now() });
}

export function registerBuddy(
  bot: { command: (cmd: string, handler: (ctx: CommandContext<Context>) => Promise<void>) => void },
): void {
  bot.command('buddy', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const buddy = getBuddyForUser(userId);
    const stageInfo = STAGE_INFO[buddy.stage];
    const moodEmoji = MOOD_EMOJI[buddy.mood] ?? '😐';

    // XP progress bar (10 segments)
    const stageThresholds: Record<string, number> = {
      seedling: 100,
      sprout: 500,
      bloom: 2000,
      guardian: 5000,
      apex: 9999,
    };
    const nextThreshold = stageThresholds[buddy.stage] ?? 9999;
    const xpInStage = buddy.xp - getStageStartXp(buddy.stage);
    const xpNeeded = nextThreshold - getStageStartXp(buddy.stage);
    const progress = Math.min(10, Math.round((xpInStage / xpNeeded) * 10));
    const progressBar = '█'.repeat(progress) + '░'.repeat(10 - progress);

    // Time since last interaction
    const hoursSinceInteraction = (Date.now() - buddy.lastInteraction) / (1000 * 60 * 60);
    const interactionStatus =
      hoursSinceInteraction < 1
        ? 'just now'
        : hoursSinceInteraction < 24
        ? `${Math.floor(hoursSinceInteraction)}h ago`
        : `${Math.floor(hoursSinceInteraction / 24)}d ago`;

    const reply =
      `${moodEmoji} *Your Buddy*\n\n` +
      `Stage: *${stageInfo?.label ?? buddy.stage}*\n` +
      `Level: ${buddy.level} • XP: ${buddy.xp}\n` +
      `[${progressBar}] → ${nextThreshold} XP\n\n` +
      `Mood: ${moodEmoji} ${buddy.mood}\n` +
      `_"${buddy.moodReason}"_\n\n` +
      `Trades: ${buddy.totalTradesExecuted}\n` +
      `Interactions: ${buddy.totalInteractions}\n` +
      `Streak: ${buddy.streakDays} days 🔥\n` +
      `Last seen: ${interactionStatus}\n\n` +
      `Trenches Mode: ${buddy.trenchesUnlocked ? '✅ Unlocked' : '🔒 Locked (reach Bloom stage)'}\n` +
      (buddy.achievements.length > 0
        ? `\nAchievements: ${buddy.achievements.slice(-3).join(', ')}`
        : '');

    await ctx.reply(reply, { parse_mode: 'Markdown' });
  });
}

function getStageStartXp(stage: string): number {
  const starts: Record<string, number> = {
    seedling: 0,
    sprout: 100,
    bloom: 500,
    guardian: 2000,
    apex: 5000,
  };
  return starts[stage] ?? 0;
}
