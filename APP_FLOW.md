# APP_FLOW.md — Binance Buddy User Flows

## Screen Inventory

| Screen | Location | Route/Trigger |
|--------|----------|---------------|
| Extension Popup | Chrome extension popup | Click extension icon |
| Sidepanel Chat | Chrome sidepanel | Click "Open Chat" or auto-open |
| Onboarding | Sidepanel | First launch, no wallet connected |
| Portfolio Dashboard | Sidepanel tab | After wallet connected |
| Trade Confirmation | Sidepanel modal | When trade is ready to execute |
| Buddy Profile | Sidepanel tab | View buddy stats/evolution |
| Settings | Sidepanel tab | API keys, preferences, mode toggle |
| Telegram Chat | Telegram app | Message the bot |

---

## Flow 1: First Launch & Onboarding

```
User installs extension
    → Extension popup shows buddy egg animation
    → "Hatch your buddy!" CTA button
    → Click → Sidepanel opens
    → Step 1: Choose your buddy (3 voxel creatures to pick from)
    → Step 2: Connect wallet (MetaMask/TrustWallet prompt)
    → Wallet connected → Buddy wakes up animation
    → Step 3: Wallet scan runs automatically (loading animation on buddy)
    → Step 4: Buddy presents profile summary
        "You're a DeFi Farmer! I see 3 active positions on PancakeSwap.
         Risk score: 6/10. Let me help you optimize."
    → Step 5: Optional — Add API keys in settings for deeper capabilities
    → Onboarding complete → Chat interface active
```

**Error states:**
- Wallet not found → "I don't see a wallet. Install MetaMask first!" + link
- User rejects connection → "No worries, you can connect later from settings."
- Scan fails (RPC error) → "BSC is being slow. I'll try again in a moment." + auto-retry

---

## Flow 2: Chat Interaction (Normal Mode)

```
User types message in sidepanel chat
    → Message sent to Execution Agent
    → Agent reads: user profile + wallet state + research reports + buddy personality
    → Agent decides: respond with info OR invoke a tool
    
If info response:
    → Buddy responds in personality-appropriate tone
    → Response appears in chat with buddy avatar

If tool invocation (e.g., "swap 0.1 BNB for CAKE"):
    → Agent calls swap_tokens tool
    → Tool fetches quote from PancakeSwap
    → Trade Confirmation modal appears:
        - Token amounts (0.1 BNB → ~12.4 CAKE)
        - Price impact (0.03%)
        - Gas estimate (~$0.15)
        - Slippage setting (0.5%)
        - [Confirm] [Cancel] buttons
    → User clicks Confirm
    → Extension signs tx via connected wallet
    → Buddy shows waiting animation
    → Tx confirmed on-chain
    → Buddy celebrates + shows result
    → XP awarded (+10 swap, +15 if profitable later)
    → Chat shows tx hash link to BSCScan
```

**Error states:**
- Insufficient balance → "You don't have enough BNB for this swap. You have X, need Y + gas."
- Tx reverts in simulation → "This trade would fail — [reason]. Want me to adjust?"
- User rejects in wallet → "Trade cancelled. No worries!"
- Tx fails on-chain → "Trade failed after sending. Gas was used. Here's what happened: [error]"

---

## Flow 3: Research Agent Background Loop

```
Every 30 minutes (configurable):
    → Research Agent activates
    → Fetches: token prices, pool TVL, yield rates, liquidity changes
    → Scans for: new high-APY farms, large whale movements, token launches
    → Produces structured research report
    → Report stored in agent context
    → If significant finding (>threshold):
        → Buddy proactively messages user:
          "Hey! I found a new CAKE-BNB farm at 45% APY on PancakeSwap. 
           Risk score: 3/10. Want me to look into it?"
    → If nothing notable:
        → Silent, no notification
```

---

## Flow 4: Trenches Mode Activation

```
User reaches Guardian stage (2000 XP)
    → Buddy announces: "You've proven yourself. Trenches Mode unlocked."
    → New toggle appears in settings: [Normal] [Trenches]
    → User toggles to Trenches
    → Buddy personality shifts (more aggressive, uses crypto slang)
    → New capabilities available:
        - Token launch sniper
        - High-APY farm scanner with auto-entry
        - Higher slippage tolerance
        - Optional auto-approve for small trades

Trenches Mode — Token Snipe Flow:
    → User sets snipe parameters: max buy (0.1 BNB), min liquidity (5 BNB)
    → Research Agent monitors PancakeSwap factory for PairCreated events
    → New pair detected
    → Safety checks run: contract verified? honeypot? liquidity locked?
    → If checks pass AND matches user rules:
        → Buddy: "New token detected! [name]. Liquidity: X BNB. Verified: ✓. 
           Sniping 0.1 BNB. ⚠️ High risk — new token, no track record."
        → Trade executes through guardrail pipeline
        → Result shown in chat
    → If checks fail:
        → Buddy: "New token [name] failed safety checks: [reasons]. Skipping."
```

---

## Flow 5: Buddy Evolution

```
User accumulates XP through:
    - Swaps (+10 XP)
    - Farm entries (+25 XP)
    - Daily check-in (+5 XP)
    - Asking questions (+2 XP)
    - Profitable trades (+15 XP bonus)
    - Trenches trades (+20 XP)

When XP crosses evolution threshold:
    → Screen dims slightly
    → Buddy glows / particles effect
    → Evolution animation plays (old form → new form)
    → "Your buddy evolved into [Stage Name]!"
    → New capabilities unlocked message
    → Buddy personality shifts to match new stage
```

---

## Flow 6: Telegram Bot

```
/start
    → Bot: "I'm Binance Buddy! Let's link your wallet."
    → Inline button: [Connect Wallet]
    → Opens WalletConnect QR or manual address entry
    → Wallet linked → "We're connected! Your buddy is at [stage] with [XP] XP."

/status
    → Bot shows: Portfolio value, top holdings, buddy mood, recent alerts

/swap 0.1 BNB CAKE
    → Bot shows quote inline
    → Inline buttons: [Confirm ✓] [Cancel ✗]
    → Confirm → executes through guardrail pipeline
    → Result message with tx hash

/buddy
    → Shows buddy image, stage, XP bar, mood, recent achievements

Free text: "what's the best farm right now?"
    → Routes to Research Agent
    → Agent responds with top opportunities from latest research report
```

---

## Flow 7: API Key Management

```
User opens Settings → API Keys tab
    → List of supported services:
        - BSCScan API (required) — [Add Key]
        - Ankr/QuickNode RPC — [Add Key]  
        - DeFiLlama — [Add Key]
        - Birdeye — [Add Key]
        - Protocol-specific APIs — [Add Key]
    → User pastes key → saved to local extension storage (encrypted)
    → Agent dynamically gains capabilities based on available keys
    → Badge shows which capabilities are active vs locked
```
