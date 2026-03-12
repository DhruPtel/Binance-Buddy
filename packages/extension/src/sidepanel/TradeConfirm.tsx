// =============================================================================
// TradeConfirm — modal overlay for swap confirmation
// Shows quote details, waits for user confirm/cancel, shows execution result
// =============================================================================

import { useState } from 'react';
import type { SwapQuote } from '@binancebuddy/core';

export type TradeConfirmState = 'confirm' | 'loading' | 'success' | 'error';

interface TradeConfirmProps {
  quote: SwapQuote;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  onConfirm: () => Promise<{ txHash?: string; error?: string }>;
  onCancel: () => void;
}

function formatAmount(raw: string, decimals = 18, displayDecimals = 6): string {
  try {
    const n = Number(BigInt(raw)) / Math.pow(10, decimals);
    if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (n >= 0.0001) return n.toFixed(displayDecimals);
    return n.toExponential(2);
  } catch {
    return raw;
  }
}

export function TradeConfirm({ quote, tokenInSymbol, tokenOutSymbol, onConfirm, onCancel }: TradeConfirmProps) {
  const [state, setState] = useState<TradeConfirmState>('confirm');
  const [txHash, setTxHash] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const priceImpactColor =
    quote.priceImpact < 1 ? 'text-green-400' :
    quote.priceImpact < 5 ? 'text-yellow-400' : 'text-red-400';

  const handleConfirm = async () => {
    setState('loading');
    try {
      const result = await onConfirm();
      if (result.error) {
        setErrorMsg(result.error);
        setState('error');
      } else {
        setTxHash(result.txHash ?? '');
        setState('success');
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
      setState('error');
    }
  };

  return (
    // Modal backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-72 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <span className="text-sm font-bold text-yellow-400">Confirm Trade</span>
          {state === 'confirm' && (
            <button
              onClick={onCancel}
              className="text-gray-500 hover:text-gray-300 text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>

        <div className="p-4 space-y-3">
          {/* ---- CONFIRM STATE ---- */}
          {state === 'confirm' && (
            <>
              {/* You pay */}
              <div className="bg-gray-800 rounded-xl p-3">
                <div className="text-xs text-gray-400 mb-1">You pay</div>
                <div className="text-lg font-bold text-white">
                  {formatAmount(quote.amountIn)} {tokenInSymbol}
                </div>
              </div>

              {/* Arrow */}
              <div className="text-center text-gray-500 text-lg">↓</div>

              {/* You receive */}
              <div className="bg-gray-800 rounded-xl p-3">
                <div className="text-xs text-gray-400 mb-1">You receive (min)</div>
                <div className="text-lg font-bold text-green-400">
                  {formatAmount(quote.amountOutMin)} {tokenOutSymbol}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Expected: {formatAmount(quote.amountOut)} {tokenOutSymbol}
                </div>
              </div>

              {/* Trade details */}
              <div className="bg-gray-800 rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">Price Impact</span>
                  <span className={priceImpactColor}>{quote.priceImpact.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Route</span>
                  <span className="text-gray-300">
                    {quote.path.length === 2 ? 'Direct' : `via WBNB`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Gas Cost</span>
                  <span className="text-gray-300">
                    {Number(quote.gasCostBnb).toFixed(5)} BNB (${quote.gasCostUsd.toFixed(2)})
                  </span>
                </div>
              </div>

              {/* High price impact warning */}
              {quote.priceImpact >= 5 && (
                <div className="bg-red-900/50 border border-red-700 rounded-xl px-3 py-2 text-xs text-red-300">
                  ⚠️ High price impact ({quote.priceImpact.toFixed(1)}%) — this trade will move the market significantly.
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={onCancel}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold bg-gray-700 hover:bg-gray-600 text-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold bg-yellow-500 hover:bg-yellow-400 text-gray-900"
                >
                  Confirm
                </button>
              </div>
            </>
          )}

          {/* ---- LOADING STATE ---- */}
          {state === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-10 h-10 border-2 border-gray-700 border-t-yellow-400 rounded-full animate-spin" />
              <div className="text-sm text-gray-300">Executing trade...</div>
              <div className="text-xs text-gray-500 text-center">
                Please wait. Do not close this panel.
              </div>
            </div>
          )}

          {/* ---- SUCCESS STATE ---- */}
          {state === 'success' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="text-4xl">✅</div>
              <div className="text-sm font-bold text-green-400">Trade Executed!</div>
              {txHash && (
                <div className="bg-gray-800 rounded-xl px-3 py-2 w-full">
                  <div className="text-xs text-gray-400 mb-1">Transaction</div>
                  <div className="text-xs font-mono text-gray-300 break-all">{txHash}</div>
                </div>
              )}
              <button
                onClick={onCancel}
                className="w-full py-2 rounded-xl text-sm font-semibold bg-yellow-500 hover:bg-yellow-400 text-gray-900 mt-2"
              >
                Done
              </button>
            </div>
          )}

          {/* ---- ERROR STATE ---- */}
          {state === 'error' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="text-4xl">❌</div>
              <div className="text-sm font-bold text-red-400">Trade Failed</div>
              <div className="bg-gray-800 rounded-xl px-3 py-2 w-full">
                <div className="text-xs text-red-300 break-all">{errorMsg}</div>
              </div>
              <button
                onClick={onCancel}
                className="w-full py-2 rounded-xl text-sm font-semibold bg-gray-700 hover:bg-gray-600 text-gray-300 mt-2"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
