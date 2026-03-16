// =============================================================================
// @binancebuddy/ai — Tool Registry
// Central registry of all agent tools. Filters by mode and availability.
// =============================================================================

import type { AgentTool, AgentContext } from '@binancebuddy/core';
import { scanWalletTool } from './scan.js';
import { swapTokensTool } from './swap.js';
import { getTokenInfoTool } from './token-info.js';
import { checkPositionsTool } from './positions.js';
import { setAlertTool } from './alerts.js';
import { findFarmsTool } from './farms.js';
import { snipeLaunchTool } from './snipe.js';
import { depositVaultTool } from './deposit-vault.js';
import { supplyLendingTool } from './supply-lending.js';
import { addLiquidityTool } from './add-liquidity.js';
import { getResearchTool } from './research.js';
import { resolveContractTool } from './resolve-contract.js';

// Ordered by frequency of expected use
const ALL_TOOLS: AgentTool[] = [
  checkPositionsTool,
  getResearchTool,
  resolveContractTool,
  scanWalletTool,
  getTokenInfoTool,
  swapTokensTool,
  depositVaultTool,
  supplyLendingTool,
  addLiquidityTool,
  findFarmsTool,
  setAlertTool,
  snipeLaunchTool,
];

/**
 * Returns the tools available for the current context.
 * Filters out Trenches-only tools if mode is 'normal'.
 */
export function getTools(context: AgentContext): AgentTool[] {
  return ALL_TOOLS.filter((tool) => {
    if (tool.requiresTrenchesMode && context.mode !== 'trenches') return false;
    return true;
  });
}

/**
 * Execute a named tool with params and context.
 * Returns the tool output or throws if tool not found.
 */
export async function executeTool(
  name: string,
  params: Record<string, unknown>,
  context: AgentContext,
): Promise<unknown> {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (tool.requiresTrenchesMode && context.mode !== 'trenches') {
    throw new Error(`Tool '${name}' requires Trenches mode.`);
  }
  return tool.handler(params, context);
}

export { ALL_TOOLS };
export type { AgentTool };
