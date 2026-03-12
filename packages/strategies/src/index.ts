// @binancebuddy/strategies — trading/DeFi strategy implementations
export { startSniper, stopSniper, isSniperActive, assessNewPair } from './trenches/sniper.js';
export type { SniperCallback, SniperConfig } from './trenches/sniper.js';
export {
  fetchFarms,
  scoreFarms,
  filterFarms,
  BASELINE_FARMS,
} from './trenches/farms.js';
export { scoreTokenRisk } from './risk.js';
