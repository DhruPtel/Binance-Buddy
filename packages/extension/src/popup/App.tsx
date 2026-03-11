// =============================================================================
// Popup — compact view: buddy avatar, portfolio value, XP bar, quick actions
// =============================================================================

import { useEffect, useState } from 'react';
import { BuddyRenderer } from '../components/BuddyRenderer';
import { xpToStage, getXpProgress, MOOD_EMOJI } from '@binancebuddy/buddy';
import type { BuddyState, WalletState } from '@binancebuddy/core';

// ---------------------------------------------------------------------------
// Default states (shown before wallet connected)
// ---------------------------------------------------------------------------

const DEFAULT_BUDDY: BuddyState = {
  creatureType: 'creature_a',
  stage: 'seedling',
  xp: 0,
  level: 1,
  mood: 'neutral',
  moodReason: 'Waiting to meet you...',
  trenchesUnlocked: false,
  achievements: [],
  lastInteraction: Date.now(),
  totalInteractions: 0,
  totalTradesExecuted: 0,
  streakDays: 0,
};

// ---------------------------------------------------------------------------
// XP Bar component
// ---------------------------------------------------------------------------

function XpBar({ xp, stage }: { xp: number; stage: BuddyState['stage'] }) {
  const progress = getXpProgress(xp, stage);
  const pct = Math.min(progress.percent, 100);

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{xp} XP</span>
        <span>{progress.nextThreshold !== null ? `${progress.current}/${progress.nextThreshold}` : 'MAX'}</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div
          className="bg-yellow-400 h-2 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main popup
// ---------------------------------------------------------------------------

export function App() {
  const [buddy, setBuddy] = useState<BuddyState>(DEFAULT_BUDDY);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [walletAddress, setWalletAddress] = useState<string>('');

  // Load persisted state from storage
  useEffect(() => {
    chrome.storage.local.get(['buddyState', 'walletState', 'walletAddress'], (result) => {
      if (result.buddyState) setBuddy(result.buddyState as BuddyState);
      if (result.walletState) setWallet(result.walletState as WalletState);
      if (result.walletAddress) setWalletAddress(result.walletAddress as string);
    });
  }, []);

  const stage = xpToStage(buddy.xp);

  const handleOpenSidepanel = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id !== undefined) {
        chrome.sidePanel.open({ tabId: tab.id });
        window.close();
      }
    });
  };

  const handleConnectWallet = () => {
    // Signal to sidepanel to handle wallet connection
    chrome.storage.local.set({ pendingWalletConnect: true });
    handleOpenSidepanel();
  };

  return (
    <div className="w-64 bg-gray-900 text-white p-3 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-yellow-400">Binance Buddy</span>
        <span className="text-xs text-gray-400 capitalize">{stage}</span>
      </div>

      {/* Buddy avatar */}
      <div className="flex justify-center">
        <BuddyRenderer mood={buddy.mood} stage={stage} size={120} />
      </div>

      {/* Mood */}
      <div className="text-center text-sm text-gray-300">
        {MOOD_EMOJI[buddy.mood]} {buddy.moodReason}
      </div>

      {/* XP bar */}
      <XpBar xp={buddy.xp} stage={stage} />

      {/* Portfolio value */}
      {wallet ? (
        <div className="bg-gray-800 rounded-lg p-2 flex justify-between items-center">
          <span className="text-xs text-gray-400">Portfolio</span>
          <span className="text-sm font-semibold text-green-400">
            ${wallet.totalValueUsd.toFixed(2)}
          </span>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg p-2 text-center text-xs text-gray-500">
          No wallet connected
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {!walletAddress ? (
          <button
            onClick={handleConnectWallet}
            className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-gray-900 text-xs font-semibold py-2 rounded-lg transition-colors"
          >
            Connect Wallet
          </button>
        ) : (
          <button
            onClick={handleOpenSidepanel}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
          >
            Open Chat
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="flex justify-between text-xs text-gray-500 border-t border-gray-800 pt-2">
        <span>Lv.{buddy.level}</span>
        <span>{buddy.totalTradesExecuted} trades</span>
        <span>{buddy.streakDays}d streak</span>
      </div>
    </div>
  );
}
