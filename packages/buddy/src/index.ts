// @binancebuddy/buddy — Tamagotchi state machine (XP, evolution, mood)
export { awardXp, xpToLevel, getXpProgress } from './xp.js';
export type { XpProgress } from './xp.js';

export { xpToStage, checkEvolution, applyEvolution, STAGE_INFO } from './evolution.js';
export type { EvolutionCheck, StageInfo } from './evolution.js';

export { deriveMood, applyMood, MOOD_EMOJI, MOOD_COLOR } from './mood.js';
export type { MoodInput } from './mood.js';
