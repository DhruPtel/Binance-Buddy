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

export const PANCAKESWAP_V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

export const PANCAKESWAP_V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function fee() external view returns (uint24)',
  'function tickSpacing() external view returns (int24)',
];

export const NONFUNGIBLE_POSITION_MANAGER_ABI = [
  'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
  'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function decreaseLiquidity(tuple(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)',
  'function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)',
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
