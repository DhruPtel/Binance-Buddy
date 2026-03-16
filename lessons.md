# Binance Buddy — Development Lessons

Update this file after every correction, every debugging session, every mistake.
The agent reads this at session start and never makes the same mistake twice.

---

## From SolVault (Solana project — pre-existing knowledge)

### Agent Architecture
- Dual agent (Research + Execution) works. Research on slow cadence, execution on user command.
- Guardrails enforce at ENGINE layer, not AI layer. The LLM plans whatever it wants — it cannot bypass simulation or risk gates.
- One recommendation per execution cycle — don't batch-execute all suggestions.
- Circuit breaker: 3 consecutive failures → auto-pause with clear message.
- Dedup by skill type, not LLM recommendation ID. Never rely on LLM-generated identifiers.
- Portfolio re-fetched each cycle so post-action state changes are visible.
- Inject strategy mandate into system prompt, enforce risk level as guardrail (not suggestion).

### Transaction Safety
- Simulate EVERY transaction before sending. No exceptions.
- Keep gas reserve (0.005 BNB on BSC, was 0.02 SOL on Solana) — never let agent spend last funds.
- Cap all amounts to (balance - fee reserve).
- If balance < reserve, auto-pause.
- LLM NEVER receives private key material.
- Token approvals are the BSC equivalent of ATA creation — must check and execute before every swap.

### Code Patterns
- BigInt values crash JSON.stringify — always add replacer function.
- Check res.headersSent before sending error responses in HTTP servers.
- Delete superseded iterative versions (v1, v2, v3... keep only final).
- Keep scripts that contain protocol knowledge (layouts, addresses, ABIs).

### Working with AI Agents (OpenClaw / Claude Code)
- Never read more than 3 files at once — causes context overload on WSL2.
- WSL2 "Catastrophic failure" caused by heavy I/O, not just memory.
- Use OPENCLAW.md as a ROUTER: tell the agent which files to read for each type of task.
- Keep progress.txt SHORT (current state only) — move history to CHANGELOG.md.
- Type definition files are the interface — agent reads types, not full source, for stable modules.
- One file at a time for fixes. Run compiler after each file.
- Don't combine audit + fix in one prompt — audit first, fix separately.
- "Don't build anything. Just assess/report" prevents premature coding.
- "Read progress.txt only" prevents the agent from vacuuming all files.
- Have the agent write plans to IMPLEMENTATION_PLAN.md before building.
- Let the agent commit after each logical unit of work.
- Always run BOTH `npx tsc --noEmit` AND `pnpm test` after changes.
- Passing tests ≠ type-safe code (tsx strips types at runtime).

### BSC-Specific (adapted from Solana)
- BSC public RPC rate limits — use Ankr free tier for reliability.
- approve() must be called before any transferFrom-based swap.
- Universal protocol execution: fetch ABI from BSCScan, let LLM read function signatures, resolve addresses, simulate, execute. Don't hardcode protocol adapters.
- EVM error patterns:
  - INSUFFICIENT_FUNDS → reduce amount or fund wallet
  - EXECUTION_REVERTED → check ABI encoding, token approvals
  - UNPREDICTABLE_GAS_LIMIT → simulation failed, bad params
  - NONCE_TOO_LOW → tx already sent, refresh nonce
  - TRANSFER_FROM_FAILED → missing token approval

---

## BSC / Binance Buddy Specific (Day 1 — Mar 10)

### pnpm / Tooling
- `@types/node@23` does NOT exist as a version tag. Use `@types/node@ts5.7` or just
  `@types/node` (latest). The versioning scheme is `ts{typescript-version}` tags, not
  Node.js version numbers.
- `npx tsc --noEmit` will silently install a rogue `tsc@2.0.4` package instead of using
  the workspace TypeScript. Always use `pnpm exec tsc --noEmit` inside a package, or
  `pnpm --filter @binancebuddy/core exec tsc --noEmit` from root. Never `npx tsc`.
- When `pnpm add -w` says "Already up to date" but the dep isn't in node_modules/.bin,
  check root `package.json` — it may already be declared but not yet linked. Run
  `pnpm install` from root to sync.

### Monorepo tsconfig
- The root `tsconfig.base.json` uses `"module": "NodeNext"` + `"moduleResolution": "NodeNext"`.
  This is correct for all Node.js packages (blockchain, ai, buddy, strategies, telegram, server).
- The `extension` package needs DIFFERENT settings for Vite/React:
  `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"jsx": "react-jsx"`,
  `"lib": ["ES2022", "DOM", "DOM.Iterable"]`, `"composite": false`, `"noEmit": true`.
  Override ALL of these in `packages/extension/tsconfig.json` — do NOT rely on base.
- When using project references (`composite: true`), the extension can't be a composite
  project if it has `noEmit: true`. Set `composite: false` on the extension.

### Workspace Structure
- The OpenClaw `workspace-binancebuddy` directory holds agent config files (SOUL.md,
  AGENTS.md, etc.) and a bare git repo. These should be merged INTO the project repo,
  not kept separate.
- `cp -rn` (no-clobber) is the right tool for merging workspace files without overwriting
  existing project files.
- The project was named "ChainBuddy" in early planning docs (DEVELOPMENT_PLAN.md) but
  canonical name is "Binance Buddy" per OPENCLAW.md. All package prefixes are
  `@binancebuddy/`, OpenClaw agent is `binancebuddy`. DEVELOPMENT_PLAN.md is legacy —
  OPENCLAW.md is authoritative.

### API / Data Sources

- **BSCScan V1 is dead** — `api.bscscan.com/api` returns "deprecated V1 endpoint" for ALL keys,
  even with a valid BSCScan key. BSCScan V2 (`api.bscscan.com/v2/api`) returns 404 — it doesn't exist.
- **Etherscan V2 for BSC requires a paid plan** — `api.etherscan.io/v2/api?chainid=56` returns
  "Free API access is not supported for this chain" on the free tier. BSC is not covered for free.
- **Ankr Enhanced API is the correct replacement** — covers BSC, free with sign-up (200M credits/month).
  - Token balances + prices in one call: `ankr_getAccountBalance` (`blockchain: ["bsc"]`)
  - Transaction history: `ankr_getTransactionsByAddress` (`blockchain: ["bsc"]`)
  - Endpoint: `POST https://rpc.ankr.com/multichain/{apiKey}` (key required even for free tier — keyless returns 403)
  - Ankr API key env var: `ANKR_API_KEY` (NOT BSCSCAN_API_KEY)
- **Ankr Enhanced API requires a paid plan** — even the "freemium" signup only gives a Node RPC key.
  The `/multichain` endpoint returns -32056 "Proxy error" with a node key.
- **Final working approach:**
  - Token balances: Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`, deployed on BSC) batches
    `balanceOf` for all SAFE_TOKENS into a single RPC call. No API key needed.
  - Prices: CoinGecko free tier (`/simple/token_price/binance-smart-chain`). Rate-limited to 30k/day.
  - Tx history: Moralis primary (`MORALIS_API_KEY`, free at moralis.io), Ankr fallback, else `[]`.
    Archetype set to `'unknown'` if neither key is set. `TraderArchetype` includes `'unknown'`.
  - Rate limiter (`rate-limiter.ts`): 30k/day hard cap, 20k warning, 60s in-memory cache.
    Prevents burning Moralis free tier. Multicall3 / on-chain reads are NOT counted (free).
- **Multicall3 health check**: use `provider.getCode(MULTICALL3_ADDRESS)` — NOT a raw fetch to a
  hardcoded RPC URL. The provider is already configured with the correct RPC.

### Type Design
- XP_THRESHOLDS as a `Record<EvolutionStage, number>` const in types.ts works cleanly
  with the stage union type — no need for a separate enum.
- Import type aliases (`TradeMode`) in constants.ts need `.js` extension on the import
  path when using NodeNext module resolution: `from './types.js'` not `from './types'`.
  Applies to ALL cross-file imports in NodeNext packages.
- Adding `'unknown'` to a discriminated union (e.g. `TraderArchetype`) may require
  re-scanning all existing switch/if chains that handle that union. Add it from the start
  if a graceful-degradation path exists.

---

## AI Agent Package (Day 3 — Mar 11)

### Anthropic SDK Tool Loop
- Tool use is multi-round. Loop until `stop_reason === 'end_turn'` OR max rounds hit.
  Each round: call Claude → extract `tool_use` blocks → execute tools → append
  `tool_result` block with `tool_use_id` → call Claude again. Max 5 rounds is safe.
- Tool schemas use `input_schema` in the Anthropic SDK, NOT `parameters`.
  Mapping: `AgentTool.parameters` (JSON Schema) → `Anthropic.Tool.input_schema`.
- `content` in Claude responses can be a string OR an array of content blocks.
  Always check `Array.isArray(content)` before iterating. Text blocks have `type: 'text'`.
- Circuit breaker counter must be module-level (not instance-level) to survive
  across calls. Reset via exported `resetCircuitBreaker()`.

### Workspace Packages in pnpm
- **Cannot `pnpm add @binancebuddy/blockchain`** — workspace packages are not in the npm
  registry. Edit `package.json` manually and add `"@binancebuddy/blockchain": "workspace:*"`.
  Then run `pnpm install` from root to link it.
- After adding a workspace dep, run `pnpm --filter @binancebuddy/core build` before
  type-checking downstream packages — stale dist causes phantom type errors.

### Server / Express with TypeScript
- `export { app }` in a server file causes TS error "inferred type cannot be named" if
  `app` is typed as `ReturnType<typeof express>`. Fix: explicitly type as
  `const app: Express = express()` with `import express, { type Express }`.
- `ANTHROPIC_API_KEY` is required for chat but the agent should degrade gracefully:
  return a clear "my API key isn't configured" message rather than throwing.

### Research Agent
- The research agent runs as an in-process `setInterval`, not a separate process.
  Runs immediately on startup, then every `RESEARCH_INTERVAL_MS` (30 min).
- `getLatestReport()` returns `null` until the first run completes — callers must
  handle null. `isReportFresh()` checks `now - report.timestamp < RESEARCH_MIN_INTERVAL_MS`.

---

## DEX Trading Engine (Day 4 — Mar 11)

### PancakeSwap V2 Routing
- Try direct pair first (`[tokenIn, tokenOut]`). If `getAmountsOut` reverts, the pair
  doesn't exist — route via WBNB (`[tokenIn, WBNB, tokenOut]`).
- `swapExactETHForTokens` requires `value: amountIn` (native BNB sent as msg.value).
  The path must start with WBNB even though caller sends native BNB.
- `swapExactTokensForETH` is for token → BNB. `swapExactTokensForTokens` for everything else.
- Always use `NATIVE_BNB_ADDRESS` (0xEeee...) as the user-facing BNB token address,
  map to `WBNB_ADDRESS` only when building the router path.

### Guardrail Pipeline Order
- Simulate BEFORE checking spending limits so you get the revert reason if it fails.
  `eth_estimateGas` is the simulation — it internally dry-runs the call and throws on revert.
- Extract revert reason from error message with regex:
  `/reverted with reason string '(.+?)'/`
- All 5 guardrail checks (simulation, spendingLimit, feeReserve, riskGate, protocolAllowlist)
  run together and aggregate into a single `GuardrailResult`. Never early-exit — user needs
  to see ALL failures, not just the first.

### Type Naming Conflicts
- `SimulationResult` is defined in BOTH `packages/core/src/types.ts` AND
  `packages/blockchain/src/dex/gas.ts`. The core version has `gasEstimate: string` (required);
  the local version has `gasEstimate?: bigint` (optional bigint). They are incompatible.
  **Fix**: when building the `GuardrailResult.simulation` object in executor.ts, populate
  `gasEstimate` from `quote.gasEstimate` (already a string), not from the local simulation result.
- When a function has two different return shapes (success/failure branches), TypeScript
  infers a union type, NOT the declared interface. Accessing a field only present in one
  branch will error even if the interface declares it optional. Use the declared return type
  annotation explicitly: `): Promise<SimulationResult>`.

### ERC-20 Approval Pattern
- Always call `checkApproval()` before every swap (even for the same token). Allowances can
  be revoked or partially consumed. Never assume unlimited approval persists.
- `MaxUint256` from ethers is the standard unlimited approval value. Import as named export.
- Approval tx must fully confirm (`tx.wait()`) before the swap tx is submitted.

### Gas Estimation
- BSC uses legacy pricing (no EIP-1559). `feeData.gasPrice` is the field to use.
  `feeData.maxFeePerGas` will be null on BSC.
- 3 gwei is a safe fallback gas price on BSC mainnet. Single-hop swaps: ~150k gas.
  Multi-hop (via WBNB): ~220k gas. Approve: ~60k gas.

---

## Strategies + Telegram + OpenClaw (Day 7 — Mar 11)

### Strategies Package
- The `strategies` package did NOT include `ethers` in its dependencies — only `@binancebuddy/blockchain`.
  Even though blockchain transitively uses ethers, TypeScript needs the direct dependency to resolve
  types. Always add `"ethers": "6"` to any package that imports from `ethers` directly.
- For sniper.ts, use `factory.on('PairCreated', handler)` with grammy-style named event listeners
  that can be removed with `factory.off('PairCreated', handler)`. Store the handler reference in
  closure so the stop function can deregister exactly it.
- `getReserves()` returns `[reserve0, reserve1, blockTimestampLast]` — TypeScript types this as
  a tuple. Destructure as `[r0, r1]: [bigint, bigint]` after calling `.then(r => [r[0], r[1]])`.
- PancakeSwap farms API URL: `https://farms-api.pancakeswap.finance/farms/v2?chainId=56`
  Public endpoint, no API key needed, returns `{ data: PancakePoolApiItem[] }`.

### Telegram Bot (grammy)
- `StageInfo` from `@binancebuddy/buddy` has `{ stage, label, description, xpThreshold, trenchesUnlocked }`.
  It does NOT have an `emoji` field — use `stageInfo.label` for display.
- grammy's `Bot` type does NOT expose `.command()` and `.callbackQuery()` at the top level for
  injection via interface — use the actual `Bot` import type and pass `bot` directly to command
  registrars. Don't try to create a minimal interface for the bot parameter.
- grammy `webhookCallback(bot, 'express')` returns an Express `RequestHandler`.
  Assign it to a variable and call `handler(req, res)` — do NOT spread or treat as middleware
  directly inside an arrow function without invoking it.
- For cross-user guard on callback queries: `ctx.from?.id` is the user who clicked the button.
  Compare to the userId embedded in the callback data (e.g., `swap_confirm:123`) to prevent
  other users from confirming someone else's swap.

### Server / Telegram Integration
- When `@binancebuddy/telegram` is first added as a server import, its dist folder may not exist.
  Run `pnpm exec tsc -p packages/telegram/tsconfig.json` (WITHOUT --noEmit) to build it first,
  then re-run `--noEmit` on the server package to get clean types.
- `implicit any` errors in Express handlers: always type destructured body as `req.body as { field?: Type }`.
  Error callbacks in `.catch()` inside route handlers should be typed as `(err: unknown)`.

### SKILL.md Files
- Skills directory lives at project root: `skills/` (one .md file per tool).
- Each file covers: description, endpoint, parameters (typed), example request, example response, notes/safety.
- OpenClaw reads these to discover capabilities at runtime — the format must stay machine-readable.
  Use consistent section headings: `## Description`, `## Endpoint`, `## Parameters`, `## Example Request`,
  `## Example Response`, `## Notes`.

---

## Dashboard + Keystore (Day 7 Infrastructure — Mar 11)

### AES-256-GCM Keystore Pattern
- `encryptPrivateKey(privateKey, password)` → `{ version, address, iv, authTag, ciphertext, salt, createdAt }`.
  ALL fields are hex strings. Store as JSON. Never store raw private key.
- `scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 })` — these scrypt params are a reasonable
  balance of security and server startup time. N=16384 takes ~20ms on a modern CPU.
- `ethers.Wallet.createRandom()` returns `HDNodeWallet`, NOT `Wallet`. The two types are NOT assignable.
  Always destructure the private key and reconstruct: `new ethers.Wallet(hdWallet.privateKey, provider)`.

### awardXp Signature (buddy package)
- `awardXp(state: BuddyState, source: XPSource)` — the XP amount is looked up from `XP_REWARDS[source]`
  internally. Do NOT pass an amount as the third argument; there is no third argument.
- After calling `awardXp`, the returned state has updated `xp` and `stage`. Always reassign: `buddyState = awardXp(buddyState, 'chat_interaction')`.

### Extension Build: vite not tsc
- `packages/extension/package.json` build script MUST be `vite build`, NOT `tsc -p tsconfig.json`.
  tsc with noEmit only type-checks; it does not produce browser bundles. Vite reads vite.config.ts and
  produces popup.js, sidepanel.js, background.js in dist/.
- The BuddyRenderer Three.js chunk will be ~650kB — this is expected and acceptable for a dev build.

### Inline Dashboard HTML in TypeScript
- The dev dashboard is a template literal string (~1000 lines) assigned to `const DASHBOARD_HTML = \`...\``.
- Backtick escaping rule: any literal backtick in the HTML must be escaped as `\\\``. Any `${` in JS
  inside the template literal must be escaped as `\${` to prevent TypeScript from interpreting them as
  interpolations. Keep all dashboard JS in a `<script>` tag with vanilla JS; no build step.
- Serving: `res.setHeader('Content-Type', 'text/html'); res.send(DASHBOARD_HTML)` in a GET / handler.

### Buddy State Persistence
- Server holds `buddyState` in-memory, loaded from `.buddy-state.json` on startup (or defaults if missing).
- Every XP-awarding code path must call `saveBuddyState()` which writes the JSON file synchronously
  (or async — JSON.stringify is fast enough that sync is fine for state files this small).
- `/api/chat` and `/api/swap/execute` are the two XP sources — both must save after awarding.

### Server: implicit any in Express handlers
- `.catch((err) =>` in route handlers needs `(err: unknown)` not `(err)` when `noImplicitAny` is on.
- Destructure request body with explicit cast: `const { field } = req.body as { field?: string }`.

### Server imports from workspace packages
- When you add a new workspace package import to server (e.g. `@binancebuddy/telegram`), the package
  dist/ may not exist yet. Run `pnpm exec tsc -p packages/<pkg>/tsconfig.json` (WITHOUT --noEmit) to
  build the dist first, THEN run `--noEmit` on the server package to get clean types.
- Never assume a workspace package dist is fresh. If you get "Output file has not been built" errors,
  build the dependency package first.

---

## Phase 2 Research — DeFiLlama Integration (Mar 13)

### Template Literal Regex Escaping (CRITICAL)
- Inside a TypeScript backtick template literal, `\*` is just `*` — the backslash is consumed
  by the template string parser before the JS engine sees it.
- `/\*\*([^*]+)\*\*/g` inside a template literal becomes `/**([^*]+)**/g` in the browser,
  which breaks JS parsing. The `g` after `/` becomes an undefined variable reference.
- **Fix**: double-escape: `/\\*\\*([^*]+)\\*\\*/g` → browser receives `/\*\*([^*]+)\*\*/g`.
- **Validation ritual**: after every change to the dashboard HTML template literal, restart
  the server, curl localhost:3000, extract the `<script>` block with sed, run `node --check`
  on the extracted JS. Never trust `tsc --noEmit` alone — TypeScript doesn't validate the
  JavaScript inside template literal strings.

### DeFiLlama API Field Mismatches
- `/protocols` endpoint does NOT have a `volume_24h` field. The code mapped `p.volume_24h ?? 0`
  which always returned 0. Volume lives on separate endpoints (`/overview/dexs`) or in
  per-pool `volumeUsd1d` from `/yields/pools`. Don't assume field names — check live API responses.
- `/protocols` uses chain name `"Binance"`, `/yields/pools` uses `"BSC"` for the same chain.
  normalizeChain() is required for any cross-endpoint join.
- `/protocols` may list a protocol on BSC but `/yields/pools` may have zero BSC entries for it
  (e.g. Curve DEX). Protocol-level presence ≠ pool-level data availability.
- `fetchPoolHistory` (`/chart/{poolId}`) returns 7 fields per data point: `timestamp`, `apy`,
  `tvlUsd`, `apyBase`, `apyReward`, `il7d`, `apyBase7d`. The original code only extracted 3.
  Always check the full API response shape, not just what the code declares.

### DeFiLlama Data Quality
- APY values for micro-TVL pools are unreliable. A pool with $500 TVL and high reward emissions
  can show 28,000% APY. Filter pools below $10k TVL before computing bestApy or showing in UI.
- Some BSC pools have non-ASCII symbols (CJK characters like 鲸平-USDT). These are real tokens
  but look broken in an English-language UI. Filter with `/[^\x20-\x7E]/` regex on symbol field.
- DeFiLlama `il7d` field is null for most pools (especially lending). Only LP pairs with
  sufficient history have IL data. Chart builders must handle null gracefully — skip the chart
  entirely if all data points are null, never show an empty chart.

### Dynamic Imports in Module Cycles
- `researchProtocol()` in research.ts needs the registry from discovery.ts to determine
  protocol category for chart selection. But discovery.ts imports from research.ts (or could
  in future). Using `await import('./discovery.js')` breaks the static cycle.
- Dynamic imports can fail at runtime (module not loaded, circular dependency timing). Always
  wrap in try/catch with a sensible fallback (e.g. category defaults to 'other').

---

## Phase 3 Research Architecture (Mar 14)

### DeFiLlama Address Format
- DeFiLlama `/protocols` returns `address` as a multi-chain string: `"bsc:0x1234...,ethereum:0xabcd..."`.
  This is NOT a single contract address. Split by comma, filter for `bsc:` prefix, strip prefix.
  If no `bsc:` entry, the protocol has no BSC contract address in DeFiLlama's data.
- Storing the raw string as `contractAddresses: [p.address]` results in addresses like
  `"bsc:0x1234...,ethereum:0xabcd..."` being passed to SQL queries — matches nothing on-chain.

### DeFiLlama Yields Endpoints (Pro Risk)
- `yields.llama.fi/pools` and `yields.llama.fi/chart/{poolId}` are marked 🔒 Pro in docs but
  legacy URLs work without a key. Could break anytime — build with GoldRush fallback.
- GoldRush fallback provides DEX pool data (TVL, volume) but NOT APY or IL data. When falling
  back, APY fields are null/0 — chart builders handle this gracefully by skipping all-zero datasets.
- Fallback trigger is `rawPools.length === 0` (empty result), NOT try/catch. `fetchYieldPools()`
  already catches errors internally and returns `[]`. Don't wrap the call in another try/catch.

### Dune Analytics BSC Tables
- `bnb.traces` is internal EVM call traces (from, to, value, gas, input, output). It does NOT
  have decoded fields like `action`, `amount_usd`, or any protocol-specific columns.
- `bnb.transactions` is top-level transactions (from, to, value, hash, block_time, success).
  Better for basic activity queries but still raw — no decoded event data.
- Protocol-specific decoded tables (e.g. `venus_bnb.Comptroller_evt_*`) contain structured
  event data (borrow, supply, liquidation events with typed fields). These are what you need
  for meaningful DeFi analysis. Use Dune MCP `searchTables` to discover available tables.
- Writing SQL templates against `bnb.traces` with columns like `action = 'borrow'` guarantees
  zero rows — those columns don't exist on the raw traces table.

### Atomic Type Union Changes
- Changing `ProtocolCategory` from `'dex' | 'lp' | ...` to `'liquidity' | ...` breaks every
  file that references the old values: `categorizeProtocol()`, `selectChartsForCategory()` switch
  cases, dashboard `VALID_CATEGORIES` array, tab buttons HTML, `tabNames` JS array, and any
  persisted registry entries with old values.
- Must update ALL consumers in one atomic commit. If you change the type union without updating
  the switch cases, `tsc --noEmit` will fail on unreachable/missing cases.
- Add `migrateRegistryCategories()` to remap persisted old values on load. Run on module init,
  write back to disk if any values changed. Must be idempotent.

### ChartConfig.description is Required
- Adding `description: string` to `ChartConfig` as a required field means every chart builder
  function must be updated in the same commit. There are 6 chart builders in research.ts.
- `buildApyBaseChart` is called with different titles per category — add a `description` parameter
  so the caller can pass context-appropriate text (lending vs liquidity vs yield descriptions).

### bestApy Bug
- `researchCategory()` computed `bestApy` using `pool.apy` (total APY including reward incentives)
  instead of `pool.apyBase` (organic yield from real protocol activity). This inflated displayed
  APY with unsustainable token incentives.
- Fix: `pool.apyBase ?? pool.apy` — prefer organic yield, fall back to total only when base is null.

### Claude with Empty Data
- `generateDeepAnalysis()` must check `totalRows === 0` before calling Claude. If all Dune queries
  returned empty results, Claude responds with "please provide data" instead of analysis.
- Return a clear template message explaining the likely cause (contract address not indexed, or
  query templates need updating for this protocol). Don't waste a Claude API call on empty data.

### GoldRush Fallback Pattern
- GoldRush fallback triggers on empty result (`rawPools.length === 0`), not on thrown error.
  `fetchYieldPools()` and `fetchPoolHistory()` both catch errors internally and return `[]`.
- Check the return value length, not a try/catch around the call. The error is already handled.

---

## Phase 4 Execution Bridge (Mar 14)

### Swap Deadline: Never Use Date.now()
- `Date.now()/1000 + deadline` relies on local machine clock. If the RPC node's view of
  `block.timestamp` is ahead of the machine clock (common with cloud RPC endpoints), the
  deadline is already expired when the tx lands. PancakeSwap reverts with `EXPIRED`.
- **Fix**: always fetch `block.timestamp` from the chain:
  `const block = await provider.getBlock('latest'); const deadline = block!.timestamp + 300;`
- This applies to ALL on-chain deadline calculations, not just swaps — LP entry, vault
  deposits with timelock, etc.

### executeSwap() Output: Parse Transfer Events
- `executeSwap()` was returning `quote.amountOut` (the estimate from `getAmountsOut`) as the
  actual output. For standalone swaps this is cosmetic, but LP entry calls `addLiquidityETH`
  with the token amount received — if it's the estimate instead of the real amount, the tx
  reverts because the balances don't match.
- **Fix**: parse the last ERC-20 Transfer event in the receipt where `to` matches the signer.
  The Transfer event topic is `keccak256('Transfer(address,address,uint256)')`. The actual
  amount is `BigInt(log.data)`. Fall back to `quote.amountOut` only if no Transfer matches.

### Don't Create Endpoints That Already Exist
- The plan proposed `/api/swap/execute-direct` as a "unified" swap endpoint. But
  `/api/swap/execute` already does quote → guardrails → execute in one call when no
  pre-fetched quote is passed in the body. The existing endpoint was already the solution.
- Before designing a new endpoint, read the existing handler code.

### Guardrails Replace Confirmation Prompts
- The original swap tool returned `requiresConfirmation: true` and waited for user input.
  This is bad UX for an agent — the user already expressed intent by asking for the swap.
- Guardrails (simulation, spending limit, fee reserve, protocol allowlist) ARE the safety
  layer. If they pass, execute immediately. If they fail, return the failure reason. The
  user never needs to click "confirm" — that's what guardrails are for.

### Token Decimals Are Not Always 18
- BSC stablecoins happen to be 18 decimals (unlike Ethereum USDC at 6), but other tokens
  may vary. Vault executors and lending executors must call `decimals()` on the token
  contract before computing `amountWei`.
- Never hardcode `const TOKEN_DECIMALS = 18` in an executor. Parse the amount with the
  actual decimals: `BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac)`.

### Package Boundaries: Data Clients Go Near Executors
- The Beefy API client fetches vault addresses needed by the vault executor. If the client
  lives in `packages/ai/` and the executor in `packages/blockchain/`, the server has to
  import from both and manually wire them. Worse, if `blockchain` needs to call `ai`,
  you get a circular dependency.
- **Fix**: put API clients in the same package as the executor that uses them. Beefy client
  → `packages/blockchain/src/yield/beefy.ts`, right next to the vault executor. The server
  resolves the address (via the client) and passes it to the executor as a plain parameter.

### Venus vToken Resolution: Match by Address, Not Symbol
- `vToken.underlying()` returns a contract address, not a symbol string. Calling
  `symbol()` on each underlying to match against a user-provided symbol is an extra RPC
  call per market and fragile (symbol strings vary: "WBNB" vs "Wrapped BNB").
- **Fix**: compare `underlying().toLowerCase()` against known `SAFE_TOKENS` addresses.
  The resolver maps `underlyingAddress → vTokenAddress`. Cache the full map for 30 minutes
  since markets rarely change.

---

## 3D Buddy Renderer + Dashboard Polish (Mar 16)

### Three.js GLB Loading in Inline Dashboard HTML
- Three.js r128 + GLTFLoader + OrbitControls loaded via CDN `<script>` tags in the
  template literal HTML `<head>`. Order matters: three.min.js first, then GLTFLoader
  (attaches `THREE.GLTFLoader`), then OrbitControls (attaches `THREE.OrbitControls`).
- OrbitControls was removed after testing — for a display-only character viewer, user
  rotation adds nothing and confuses the presentation. Fixed camera is better for demos.
- GLB model centering: compute `Box3` from loaded scene, get center + size, normalize
  scale to `1.6 / maxDim`, translate to `-center * scale`. Store `baseScale` and `baseY`
  in `userData` so animations have stable references.

### Camera Iteration Pattern
- Getting the right camera angle for a character viewer took 5 iterations. Start with
  the defaults, then adjust one axis at a time. Final: `(0, 1.4, 2.8)` FOV 40°,
  `lookAt(0, 0.6, 0)` — front-facing, slightly elevated, full body visible.
- Don't add `Math.PI` to rotation unless the model's default facing is away from camera.
  Most GLB exports face +Z (toward camera at default). Test before assuming.

### Animation State Machine
- Idle animations should be almost imperceptible. The first attempt (Y bobbing + Z tilt +
  breathing scale) was too busy. Final: just a slow Y-axis look-around (`sin(t*0.5)*0.15`
  ≈ 8° each way). Less is more for a persistent on-screen companion.
- Event animations (bounce, spin) use a `0→1` decay state: set to `1.0` on trigger,
  subtract each frame. Animation code checks `if (state > 0)` and applies the effect.
  Clean, composable, no timers needed.
- Spin event must override idle rotation (`if/else`), not add to it. Otherwise the idle
  `rotation.y = sin(...)` resets the spin every frame.

### express.static for Serving GLB Models
- `app.use('/public', express.static(...))` with `__dirname + '/../public'` works for
  CJS output (module: NodeNext without `"type": "module"` in package.json).
- `import.meta.url` does NOT work in files that compile to CommonJS — TypeScript error
  TS1470. Use `__dirname` instead. Check `module` setting in tsconfig.base.json.

### resolveToken Must Not Throw
- A helper function called from Express route handlers must NEVER throw uncaught errors.
  `resolveToken()` was called outside a try block in the lending endpoint — an unknown
  token symbol crashed the entire server process.
- **Fix**: return `null` for unknown inputs, let the caller decide how to respond (400).
  Defensive returns > thrown exceptions in HTTP handler utility functions.

### Dashboard JS Validation Ritual
- After every change to the inline `<script>` in the template literal:
  1. Kill old server (`kill $(lsof -ti:3000)`)
  2. Start fresh server
  3. `curl -s localhost:3000 | extract <script> block | node --check`
- The old server may still be running from a previous session. EADDRINUSE means your
  curl is hitting stale code. Always kill first, then verify.
- `tsc --noEmit` does NOT validate JavaScript inside template literal strings. Only
  `node --check` on the extracted JS catches syntax errors in the dashboard code.

### API Key Leaks in .env.example
- `.env.example` should contain placeholder values only (empty strings or `your_key_here`).
  Never commit real API keys — even "free tier" keys. Check `git diff .env.example`
  before committing.
