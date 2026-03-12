// =============================================================================
// Settings — API key management, mode toggle, server config, wallet info
// =============================================================================

import { useState, useEffect } from 'react';
import type { BuddyState } from '@binancebuddy/core';

interface SettingsProps {
  buddy: BuddyState;
  walletAddress: string;
  onModeChange?: (mode: 'normal' | 'trenches') => void;
}

interface StoredSettings {
  serverUrl: string;
  anthropicApiKey: string;
  tradeMode: 'normal' | 'trenches';
}

const DEFAULT_SETTINGS: StoredSettings = {
  serverUrl: 'http://localhost:3000',
  anthropicApiKey: '',
  tradeMode: 'normal',
};

export function Settings({ buddy, walletAddress, onModeChange }: SettingsProps) {
  const [settings, setSettings] = useState<StoredSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null);
  const [showKey, setShowKey] = useState(false);

  // Load stored settings on mount
  useEffect(() => {
    chrome.storage.local.get(['settings'], (result) => {
      if (result.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...(result.settings as Partial<StoredSettings>) });
      }
    });
  }, []);

  const save = () => {
    chrome.storage.local.set({ settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    if (onModeChange) onModeChange(settings.tradeMode);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${settings.serverUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
      setTestResult(res.ok ? 'ok' : 'error');
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  };

  const handleModeToggle = () => {
    if (!buddy.trenchesUnlocked && settings.tradeMode === 'normal') return;
    const next = settings.tradeMode === 'normal' ? 'trenches' : 'normal';
    setSettings((s) => ({ ...s, tradeMode: next }));
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Server URL */}
        <section className="bg-gray-800 rounded-xl p-4 space-y-3">
          <div className="text-xs font-semibold text-yellow-400 uppercase tracking-widest">Server</div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Server URL</label>
            <input
              type="text"
              value={settings.serverUrl}
              onChange={(e) => setSettings((s) => ({ ...s, serverUrl: e.target.value }))}
              className="w-full bg-gray-700 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-yellow-500"
              placeholder="http://localhost:3000"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={testConnection}
              disabled={testing}
              className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            {testResult === 'ok' && (
              <span className="text-xs text-green-400">✓ Connected</span>
            )}
            {testResult === 'error' && (
              <span className="text-xs text-red-400">✗ Cannot reach server</span>
            )}
          </div>
        </section>

        {/* Anthropic API Key */}
        <section className="bg-gray-800 rounded-xl p-4 space-y-3">
          <div className="text-xs font-semibold text-yellow-400 uppercase tracking-widest">AI</div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Anthropic API Key (optional)</label>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.anthropicApiKey}
                onChange={(e) => setSettings((s) => ({ ...s, anthropicApiKey: e.target.value }))}
                className="flex-1 bg-gray-700 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-yellow-500"
                placeholder="sk-ant-..."
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="text-xs text-gray-500 hover:text-gray-300 px-2"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="text-xs text-gray-600 mt-1">
              Stored locally. Never sent to third parties.
            </div>
          </div>
        </section>

        {/* Trade Mode */}
        <section className="bg-gray-800 rounded-xl p-4 space-y-3">
          <div className="text-xs font-semibold text-yellow-400 uppercase tracking-widest">Trade Mode</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-200 font-medium">
                {settings.tradeMode === 'normal' ? '🌱 Normal Mode' : '⚔️ Trenches Mode'}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {settings.tradeMode === 'normal'
                  ? 'Max 1% slippage, conservative guardrails'
                  : 'Up to 15% slippage, high-risk enabled'}
              </div>
            </div>
            <button
              onClick={handleModeToggle}
              disabled={!buddy.trenchesUnlocked && settings.tradeMode === 'normal'}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                settings.tradeMode === 'trenches' ? 'bg-red-600' : 'bg-gray-600'
              } ${!buddy.trenchesUnlocked && settings.tradeMode === 'normal' ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  settings.tradeMode === 'trenches' ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          {!buddy.trenchesUnlocked && (
            <div className="text-xs text-gray-600">
              🔒 Trenches unlocks at Bloom stage (500 XP). Current XP: {buddy.xp}
            </div>
          )}
        </section>

        {/* Wallet */}
        {walletAddress && (
          <section className="bg-gray-800 rounded-xl p-4 space-y-2">
            <div className="text-xs font-semibold text-yellow-400 uppercase tracking-widest">Wallet</div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Connected Address</label>
              <div className="text-xs font-mono text-gray-300 break-all">{walletAddress}</div>
            </div>
          </section>
        )}

        {/* Save button */}
        <button
          onClick={save}
          className="w-full py-2.5 rounded-xl text-sm font-semibold bg-yellow-500 hover:bg-yellow-400 text-gray-900 transition-colors"
        >
          {saved ? '✓ Saved' : 'Save Settings'}
        </button>

        {/* Version */}
        <div className="text-xs text-gray-600 text-center pb-2">
          Binance Buddy v0.1.0 — your AI DeFi companion
        </div>
      </div>
    </div>
  );
}
