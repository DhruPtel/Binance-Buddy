// =============================================================================
// set_alert — create price/liquidity alerts (in-memory store)
// =============================================================================

import type { AgentTool, AgentContext, Alert, AlertCondition } from '@binancebuddy/core';
import { SAFE_TOKENS } from '@binancebuddy/core';

// In-memory alert store (persisted to Redis in Day 7)
const alertStore = new Map<string, Alert>();

export function getAlerts(): Alert[] {
  return Array.from(alertStore.values()).filter((a) => a.active);
}

export function clearTriggeredAlerts(): void {
  for (const [id, alert] of alertStore.entries()) {
    if (alert.triggeredAt) alertStore.delete(id);
  }
}

export const setAlertTool: AgentTool = {
  name: 'set_alert',
  description:
    'Set a price or liquidity alert for a token. ' +
    'Supported conditions: price_above, price_below, price_change_pct, new_pair. ' +
    'The alert will trigger when the condition is met during the next research cycle.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['price_above', 'price_below', 'price_change_pct', 'liquidity_below', 'new_pair'],
        description: 'The condition type.',
      },
      token: {
        type: 'string',
        description: 'Token symbol or contract address to monitor.',
      },
      threshold: {
        type: 'number',
        description: 'The trigger value: USD price for price_above/below, percentage for price_change_pct, USD for liquidity_below.',
      },
      direction: {
        type: 'string',
        enum: ['up', 'down'],
        description: 'For price_change_pct: which direction triggers the alert.',
      },
    },
    required: ['type', 'threshold'],
  },
  handler: async (params: Record<string, unknown>, _context: AgentContext) => {
    const type = params.type as Alert['condition']['type'];
    const threshold = Number(params.threshold);
    const token = params.token ? String(params.token) : undefined;

    if (isNaN(threshold)) return { error: 'threshold must be a number' };

    // Resolve token address
    let tokenAddress: string | undefined;
    if (token) {
      if (token.startsWith('0x')) {
        tokenAddress = token.toLowerCase();
      } else {
        const found = SAFE_TOKENS[token.toUpperCase()];
        if (!found) return { error: `Unknown token: ${token}` };
        tokenAddress = found.toLowerCase();
      }
    }

    const condition: AlertCondition = {
      type,
      threshold,
      tokenAddress,
      direction: params.direction as 'up' | 'down' | undefined,
    };

    const id = `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const alert: Alert = {
      id,
      condition,
      active: true,
      createdAt: Math.floor(Date.now() / 1000),
    };

    alertStore.set(id, alert);

    return {
      success: true,
      alertId: id,
      message: buildAlertDescription(condition, token),
      activeAlerts: alertStore.size,
    };
  },
};

function buildAlertDescription(condition: AlertCondition, tokenSymbol?: string): string {
  const name = tokenSymbol ?? condition.tokenAddress ?? 'any token';
  switch (condition.type) {
    case 'price_above': return `Alert: ${name} price rises above $${condition.threshold}`;
    case 'price_below': return `Alert: ${name} price drops below $${condition.threshold}`;
    case 'price_change_pct': return `Alert: ${name} moves ${condition.direction ?? 'any'} ${condition.threshold}%`;
    case 'liquidity_below': return `Alert: ${name} liquidity drops below $${condition.threshold}`;
    case 'new_pair': return `Alert: new trading pairs detected`;
    default: return `Alert set`;
  }
}
