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
