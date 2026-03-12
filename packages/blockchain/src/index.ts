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

export {
  getSwapQuote,
  findBestPath,
  checkApproval,
  executeApproval,
  getGasPrice,
  estimateGasCost,
  simulateTransaction,
  prepareSwap,
  executeSwap,
} from './dex/index.js';
export type { GasEstimate } from './dex/index.js';

export {
  encryptPrivateKey,
  decryptPrivateKey,
  saveKeystore,
  loadKeystore,
  getOrCreateAgentWallet,
} from './keystore.js';
export type { KeystoreFile, AgentWalletInfo } from './keystore.js';
