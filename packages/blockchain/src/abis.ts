// =============================================================================
// @binancebuddy/blockchain — Shared ABI Registry
// Minimal human-readable ABIs for all supported protocol interactions.
// =============================================================================

export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

export const VENUS_VTOKEN_ABI = [
  'function mint(uint256 mintAmount) external returns (uint256)',
  'function redeem(uint256 redeemTokens) external returns (uint256)',
  'function redeemUnderlying(uint256 redeemAmount) external returns (uint256)',
  'function underlying() external view returns (address)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function balanceOfUnderlying(address owner) external returns (uint256)',
  'function exchangeRateStored() external view returns (uint256)',
];

export const VENUS_COMPTROLLER_ABI = [
  'function getAllMarkets() external view returns (address[])',
  'function enterMarkets(address[] calldata vTokens) external returns (uint256[])',
  'function getAccountLiquidity(address account) external view returns (uint256, uint256, uint256)',
];

export const BEEFY_VAULT_ABI = [
  'function deposit(uint256 _amount) external',
  'function depositAll() external',
  'function withdraw(uint256 _shares) external',
  'function withdrawAll() external',
  'function want() external view returns (address)',
  'function balance() external view returns (uint256)',
  'function getPricePerFullShare() external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
];
