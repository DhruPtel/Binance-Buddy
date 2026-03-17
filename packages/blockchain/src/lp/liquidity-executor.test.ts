import { describe, it, expect } from 'vitest';
import { JsonRpcProvider, Wallet, ethers } from 'ethers';
import { config as dotenvConfig } from 'dotenv';
import { resolve as pathResolve } from 'path';
import { executeLPEntry } from './liquidity-executor.js';

dotenvConfig({ path: pathResolve(__dirname, '../../../../.env') });

const CAKE_ADDRESS = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';
const BNB_AMOUNT = '0.003';
const SLIPPAGE_BPS = 100;
// Approximate — close enough for guardrail math in this test
const BNB_PRICE_USD = 600;

describe('executeLPEntry — BSC mainnet integration', () => {
  it('adds CAKE/BNB liquidity using agent wallet', async () => {
    const privateKey = process.env.PRIVATE_KEY;
    const rpcUrl = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';

    if (!privateKey) {
      console.log('PRIVATE_KEY not set — skipping on-chain LP test');
      return;
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const signer = new Wallet(privateKey, provider);
    const signerAddress = await signer.getAddress();

    const bnbBalWei = await provider.getBalance(signerAddress);
    const bnbBal = parseFloat(ethers.formatEther(bnbBalWei));
    console.log(`Wallet: ${signerAddress}`);
    console.log(`BNB balance: ${bnbBal.toFixed(6)} BNB`);
    console.log(`LP entry: ${BNB_AMOUNT} BNB → CAKE/BNB pool`);

    if (bnbBal < parseFloat(BNB_AMOUNT) + 0.001) {
      console.log(`Insufficient BNB (need ${BNB_AMOUNT} + gas) — skipping`);
      return;
    }

    const result = await executeLPEntry(
      provider,
      signer,
      CAKE_ADDRESS,
      BNB_AMOUNT,
      SLIPPAGE_BPS,
      BNB_PRICE_USD,
    );

    console.log('\n--- LP Result ---');
    console.log('success:', result.success);
    console.log('poolVersion:', result.poolVersion);
    if (result.txHash) console.log('txHash:', result.txHash);
    if (result.lpTokensReceived) console.log('LP tokens received:', result.lpTokensReceived);
    if (result.pairAddress) console.log('pair/pool address:', result.pairAddress);
    if (result.error) console.log('error:', result.error);
    console.log('\nSteps:');
    for (const step of result.steps) {
      const tx = step.txHash ? ` — tx: ${step.txHash.slice(0, 16)}...` : '';
      console.log(`  [${step.status}] ${step.label}${tx}`);
    }

    if (!result.success) {
      console.error('LP failed:', result.error);
    }

    expect(result.success).toBe(true);
  }, 120_000);
});
