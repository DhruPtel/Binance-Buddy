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

export const PANCAKESWAP_ROUTER_LP_ABI = [
  'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)',
];

export const PANCAKESWAP_FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

export const PANCAKESWAP_PAIR_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
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
