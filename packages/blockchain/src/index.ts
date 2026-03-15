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
  ERC20_ABI,
  BEEFY_VAULT_ABI,
  VENUS_VTOKEN_ABI,
  VENUS_COMPTROLLER_ABI,
  PANCAKESWAP_ROUTER_LP_ABI,
  PANCAKESWAP_FACTORY_ABI,
  PANCAKESWAP_PAIR_ABI,
} from './abis.js';

export {
  findVaultForToken,
  findVaultByPlatform,
  prepareVaultDeposit,
  executeVaultDeposit,
} from './yield/index.js';
export type { BeefyVault, VaultDepositResult, VaultDepositParams } from './yield/index.js';

export { executeLPEntry } from './lp/index.js';
export type { LPExecutionResult, LPExecutionStep } from './lp/index.js';

export {
  resolveVToken,
  executeLendingSupply,
  getAccountLiquidity,
} from './lending/index.js';
export type { LendingSupplyResult } from './lending/index.js';

export {
  encryptPrivateKey,
  decryptPrivateKey,
  saveKeystore,
  loadKeystore,
  getOrCreateAgentWallet,
} from './keystore.js';
export type { KeystoreFile, AgentWalletInfo } from './keystore.js';
