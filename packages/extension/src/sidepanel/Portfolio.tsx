// =============================================================================
// Portfolio — total value, token list with balances and prices
// =============================================================================

import type { WalletState, TokenInfo } from '@binancebuddy/core';

interface PortfolioProps {
  wallet: WalletState | null;
  onRefresh: () => void;
  isLoading: boolean;
}

function TokenRow({ token }: { token: TokenInfo }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">
          {token.symbol.slice(0, 2)}
        </div>
        <div>
          <div className="text-sm font-medium text-white">{token.symbol}</div>
          <div className="text-xs text-gray-500">{token.balanceFormatted.toFixed(4)}</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-medium text-white">${token.valueUsd.toFixed(2)}</div>
        <div className="text-xs text-gray-500">${token.priceUsd.toFixed(4)}</div>
      </div>
    </div>
  );
}

export function Portfolio({ wallet, onRefresh, isLoading }: PortfolioProps) {
  if (!wallet) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
        <div className="text-4xl">👛</div>
        <div className="text-sm">Connect a wallet to see your portfolio</div>
      </div>
    );
  }

  const sortedTokens = [...wallet.tokens].sort((a, b) => b.valueUsd - a.valueUsd);

  return (
    <div className="flex flex-col h-full">
      {/* Total value header */}
      <div className="p-4 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-400">Total Portfolio Value</div>
            <div className="text-2xl font-bold text-white">
              ${wallet.totalValueUsd.toFixed(2)}
            </div>
          </div>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40"
          >
            {isLoading ? 'Scanning...' : '↻ Refresh'}
          </button>
        </div>

        {/* BNB balance */}
        <div className="mt-2 flex items-center gap-2 text-sm text-gray-300">
          <span className="w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center text-xs">B</span>
          <span>{wallet.bnbBalanceFormatted.toFixed(4)} BNB</span>
        </div>

        <div className="text-xs text-gray-600 mt-1">
          Scanned {new Date(wallet.lastScanned * 1000).toLocaleTimeString()}
        </div>
      </div>

      {/* Token list */}
      <div className="flex-1 overflow-y-auto px-4">
        {sortedTokens.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">No tokens found</div>
        ) : (
          sortedTokens.map((token) => (
            <TokenRow key={token.address} token={token} />
          ))
        )}
      </div>
    </div>
  );
}
