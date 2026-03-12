// =============================================================================
// Sidepanel — tab navigation: Chat, Portfolio, Buddy, Settings
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Chat } from './Chat';
import { Portfolio } from './Portfolio';
import { Settings } from './Settings';
import { BuddyRenderer } from '../components/BuddyRenderer';
import { connectWallet, getConnection, listenForWalletChanges, isBscMainnet } from '../wallet-bridge';
import { xpToStage, MOOD_EMOJI, STAGE_INFO } from '@binancebuddy/buddy';
import type { BuddyState, WalletState } from '@binancebuddy/core';

type Tab = 'chat' | 'portfolio' | 'buddy' | 'settings';

const DEFAULT_BUDDY: BuddyState = {
  creatureType: 'creature_a',
  stage: 'seedling',
  xp: 0,
  level: 1,
  mood: 'neutral',
  moodReason: 'Ready to help.',
  trenchesUnlocked: false,
  achievements: [],
  lastInteraction: Date.now(),
  totalInteractions: 0,
  totalTradesExecuted: 0,
  streakDays: 0,
};

export function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [buddy, setBuddy] = useState<BuddyState>(DEFAULT_BUDDY);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [chainWarning, setChainWarning] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [connectError, setConnectError] = useState('');

  const stage = xpToStage(buddy.xp);

  // Load stored state on mount
  useEffect(() => {
    chrome.storage.local.get(['buddyState', 'walletState', 'walletAddress'], (result) => {
      if (result.buddyState) setBuddy(result.buddyState as BuddyState);
      if (result.walletState) setWallet(result.walletState as WalletState);
      if (result.walletAddress) setWalletAddress(result.walletAddress as string);
    });

    // Auto-connect if previously connected
    getConnection().then((conn) => {
      if (conn) {
        setWalletAddress(conn.address);
        setChainWarning(!isBscMainnet(conn.chainId));
      }
    });
  }, []);

  // Listen for wallet changes
  useEffect(() => {
    const cleanup = listenForWalletChanges((conn) => {
      if (!conn) {
        setWalletAddress('');
        setChainWarning(false);
      } else {
        setWalletAddress(conn.address);
        setChainWarning(!isBscMainnet(conn.chainId));
      }
    });
    return cleanup;
  }, []);

  const scanWallet = useCallback(async (address: string) => {
    setIsScanning(true);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SCAN_WALLET', address }) as
        { success: boolean; walletState?: WalletState; error?: string };
      if (result?.walletState) {
        setWallet(result.walletState);
        chrome.storage.local.set({ walletState: result.walletState });
      }
    } catch {
      // server not running
    } finally {
      setIsScanning(false);
    }
  }, []);

  const handleConnect = async () => {
    setConnectError('');
    try {
      const conn = await connectWallet();
      setWalletAddress(conn.address);
      setChainWarning(!isBscMainnet(conn.chainId));
      chrome.storage.local.set({ walletAddress: conn.address });
      await scanWallet(conn.address);
    } catch (err: unknown) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed');
    }
  };

  const tabs: { id: Tab; label: string; emoji: string }[] = [
    { id: 'chat', label: 'Chat', emoji: '💬' },
    { id: 'portfolio', label: 'Portfolio', emoji: '📊' },
    { id: 'buddy', label: 'Buddy', emoji: '🐾' },
    { id: 'settings', label: 'Settings', emoji: '⚙️' },
  ];

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-yellow-400">Binance Buddy</span>
          <span className="text-xs text-gray-500 capitalize">{stage}</span>
        </div>
        <div className="flex items-center gap-2">
          {walletAddress ? (
            <span className="text-xs text-green-400">
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </span>
          ) : (
            <button
              onClick={handleConnect}
              className="text-xs bg-yellow-500 hover:bg-yellow-400 text-gray-900 font-semibold px-2 py-1 rounded-lg"
            >
              Connect
            </button>
          )}
        </div>
      </div>

      {/* Chain warning */}
      {chainWarning && (
        <div className="bg-orange-900 border-b border-orange-700 px-3 py-1 text-xs text-orange-300">
          ⚠️ Please switch to BNB Chain (BSC Mainnet)
        </div>
      )}

      {/* Connect error */}
      {connectError && (
        <div className="bg-red-900 border-b border-red-700 px-3 py-1 text-xs text-red-300">
          {connectError}
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'chat' && (
          <Chat
            walletAddress={walletAddress}
            buddyMood={buddy.mood}
            buddyStage={stage}
          />
        )}
        {tab === 'portfolio' && (
          <Portfolio
            wallet={wallet}
            onRefresh={() => walletAddress && scanWallet(walletAddress)}
            isLoading={isScanning}
          />
        )}
        {tab === 'buddy' && (
          <div className="flex flex-col items-center gap-4 p-4 overflow-y-auto h-full">
            <BuddyRenderer mood={buddy.mood} stage={stage} size={180} />
            <div className="text-center">
              <div className="text-lg font-bold text-yellow-400">
                {MOOD_EMOJI[buddy.mood]} {STAGE_INFO[stage].label}
              </div>
              <div className="text-sm text-gray-400 mt-1">{buddy.moodReason}</div>
            </div>
            <div className="w-full bg-gray-800 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Level</span>
                <span className="text-white font-semibold">{buddy.level}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">XP</span>
                <span className="text-white font-semibold">{buddy.xp}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Trades</span>
                <span className="text-white font-semibold">{buddy.totalTradesExecuted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Streak</span>
                <span className="text-white font-semibold">{buddy.streakDays} days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Trenches</span>
                <span className={buddy.trenchesUnlocked ? 'text-green-400' : 'text-gray-600'}>
                  {buddy.trenchesUnlocked ? 'Unlocked 🔓' : `Unlocks at bloom (500 XP)`}
                </span>
              </div>
            </div>
            <div className="text-xs text-gray-600 text-center">
              {STAGE_INFO[stage].description}
            </div>
          </div>
        )}
        {tab === 'settings' && (
          <Settings buddy={buddy} walletAddress={walletAddress} />
        )}
      </div>

      {/* Bottom tab bar */}
      <div className="flex border-t border-gray-700 bg-gray-800">
        {tabs.map(({ id, label, emoji }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex flex-col items-center py-2 text-xs transition-colors ${
              tab === id ? 'text-yellow-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <span className="text-base">{emoji}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
