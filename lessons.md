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

## BSC / Binance Buddy Specific (add as we discover)

(empty — will fill during development)
