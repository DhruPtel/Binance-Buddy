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
