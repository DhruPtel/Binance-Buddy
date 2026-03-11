// @binancebuddy/blockchain — BNB Chain interactions, wallet, tx building
export {
  createProvider,
  createFallbackProvider,
  checkProviderHealth,
  getBnbBalance,
  type Network,
} from './provider.js';

export {
  getTokenBalance,
  getTokenPrices,
  getBnbPriceUsd,
  scanTokens,
} from './tokens.js';

export {
  fetchTransactionHistory,
  categorizeTx,
  identifyProtocol,
  countByCategory,
  getProtocolUsage,
} from './history.js';

export {
  scanWallet,
  buildProfile,
} from './scanner.js';

export { rateLimiter } from './rate-limiter.js';
