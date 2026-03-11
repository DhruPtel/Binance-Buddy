// =============================================================================
// Background Service Worker — handles alarms, storage sync, sidepanel toggle
// =============================================================================

const SERVER_URL = 'http://localhost:3000';
const RESEARCH_ALARM = 'research-refresh';
const RESEARCH_PERIOD_MINUTES = 30;

// ---------------------------------------------------------------------------
// Install / startup
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  // Set up a 30-min alarm to refresh research data
  chrome.alarms.create(RESEARCH_ALARM, {
    periodInMinutes: RESEARCH_PERIOD_MINUTES,
    delayInMinutes: 1,
  });
});

// ---------------------------------------------------------------------------
// Alarm handler — refresh research report from server
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== RESEARCH_ALARM) return;

  try {
    const res = await fetch(`${SERVER_URL}/api/research/latest`);
    if (!res.ok) return;
    const report = await res.json() as Record<string, unknown>;
    await chrome.storage.local.set({ researchReport: report, researchUpdatedAt: Date.now() });
  } catch {
    // Server may not be running — swallow silently
  }
});

// ---------------------------------------------------------------------------
// Action click — open sidepanel
// ---------------------------------------------------------------------------

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
    // Fallback: sidepanel may not be supported
  });
});

// ---------------------------------------------------------------------------
// Message router — popup/sidepanel → background → server
// ---------------------------------------------------------------------------

type BackgroundMessage =
  | { type: 'SCAN_WALLET'; address: string }
  | { type: 'GET_RESEARCH' }
  | { type: 'CHAT'; message: string; address: string; history: unknown[] };

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((err: unknown) => {
    sendResponse({ error: err instanceof Error ? err.message : String(err) });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg: BackgroundMessage): Promise<unknown> {
  switch (msg.type) {
    case 'SCAN_WALLET': {
      const res = await fetch(`${SERVER_URL}/api/wallet/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: msg.address }),
      });
      return res.json();
    }

    case 'GET_RESEARCH': {
      // Try cache first
      const cached = await chrome.storage.local.get(['researchReport', 'researchUpdatedAt']);
      const age = Date.now() - (Number(cached.researchUpdatedAt) || 0);
      if (cached.researchReport && age < 30 * 60 * 1000) {
        return cached.researchReport;
      }
      // Fetch fresh
      const res = await fetch(`${SERVER_URL}/api/research/latest`);
      if (!res.ok) return cached.researchReport ?? null;
      const report = await res.json() as Record<string, unknown>;
      await chrome.storage.local.set({ researchReport: report, researchUpdatedAt: Date.now() });
      return report;
    }

    case 'CHAT': {
      const res = await fetch(`${SERVER_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg.message,
          walletAddress: msg.address,
          conversationHistory: msg.history,
        }),
      });
      return res.json();
    }

    default:
      return { error: 'Unknown message type' };
  }
}
