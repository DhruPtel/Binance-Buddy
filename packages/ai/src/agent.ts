// =============================================================================
// @binancebuddy/ai — Execution Agent
// Single-turn agent loop: receives a user message, calls Claude with tools,
// handles tool_use blocks, returns a typed AgentMessage.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentContext,
  AgentMessage,
  ExecutionResult,
} from '@binancebuddy/core';
import { CIRCUIT_BREAKER_THRESHOLD, XP_REWARDS } from '@binancebuddy/core';
import { buildSystemPrompt } from './prompts/system.js';
import { getTools, executeTool } from './tools/index.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 5; // prevent infinite loops

// ---------------------------------------------------------------------------
// Consecutive failure tracking (circuit breaker)
// ---------------------------------------------------------------------------

let consecutiveFailures = 0;

function recordSuccess(): void { consecutiveFailures = 0; }
function recordFailure(): boolean {
  consecutiveFailures++;
  return consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Convert our AgentTool schema into Anthropic SDK tool format
// ---------------------------------------------------------------------------

function toAnthropicTools(
  tools: ReturnType<typeof getTools>,
): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool['input_schema'],
  }));
}

// ---------------------------------------------------------------------------
// Main agent entry point
// ---------------------------------------------------------------------------

/**
 * Process one user message through the execution agent.
 * Handles multi-round tool use (up to MAX_TOOL_ROUNDS).
 * Returns structured ExecutionResult.
 */
export async function runAgent(
  userMessage: string,
  context: AgentContext,
  conversationHistory: Anthropic.MessageParam[] = [],
  apiKey?: string,
): Promise<ExecutionResult & { reply: string; updatedHistory: Anthropic.MessageParam[] }> {
  const anthropicKey = apiKey ?? process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    return {
      success: false,
      error: 'ANTHROPIC_API_KEY not set. Set it in .env to enable the AI agent.',
      xpAwarded: 0,
      circuitBreakerTripped: false,
      reply: "I can't think right now — my API key isn't configured. Set ANTHROPIC_API_KEY in .env.",
      updatedHistory: conversationHistory,
    };
  }

  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    return {
      success: false,
      error: 'Circuit breaker tripped — 3 consecutive failures. Auto-paused.',
      xpAwarded: 0,
      circuitBreakerTripped: true,
      reply: '⛔ I\'ve hit 3 errors in a row and paused for safety. Please check the logs, then type "reset" to continue.',
      updatedHistory: conversationHistory,
    };
  }

  const client = new Anthropic({ apiKey: anthropicKey });
  const tools = getTools(context);
  const systemPrompt = buildSystemPrompt(context, tools);

  // Build message history for this turn
  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  let finalReply = '';
  let toolName: string | undefined;
  let toolOutput: unknown;
  let xpAwarded = 0;
  let rounds = 0;

  try {
    // Agentic loop: keep calling Claude until it stops using tools
    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: toAnthropicTools(tools),
        messages,
      });

      // Collect any text from this response
      const textBlocks = response.content.filter((b) => b.type === 'text');
      if (textBlocks.length > 0) {
        finalReply = textBlocks.map((b) => (b as Anthropic.TextBlock).text).join('\n');
      }

      // If done — no more tool calls
      if (response.stop_reason === 'end_turn') break;

      // Process tool_use blocks
      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) break;

      // Add assistant turn to history
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        const tu = block as Anthropic.ToolUseBlock;
        toolName = tu.name;

        try {
          const result = await executeTool(
            tu.name,
            tu.input as Record<string, unknown>,
            context,
          );
          toolOutput = result;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          });

          // Award XP for tool use
          xpAwarded += XP_REWARDS.chat_interaction ?? 1;
        } catch (toolErr) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: `Error: ${String(toolErr)}`,
            is_error: true,
          });
        }
      }

      // Add tool results turn
      messages.push({ role: 'user', content: toolResults });
    }

    // If Claude never gave text (pure tool-only response), summarise
    if (!finalReply) {
      finalReply = toolOutput
        ? `Done. Here's what I found:\n${JSON.stringify(toolOutput, null, 2)}`
        : 'Done.';
    }

    recordSuccess();

    // Strip system prompt from history we return (keep only user/assistant turns)
    const updatedHistory = messages;

    return {
      success: true,
      toolName,
      output: toolOutput,
      xpAwarded,
      circuitBreakerTripped: false,
      reply: finalReply,
      updatedHistory,
    };
  } catch (err) {
    const tripped = recordFailure();
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[agent] Error:', errorMsg);

    return {
      success: false,
      error: errorMsg,
      xpAwarded: 0,
      circuitBreakerTripped: tripped,
      reply: tripped
        ? '⛔ Too many errors in a row. I\'ve paused for safety. Check the logs.'
        : `Something went wrong: ${errorMsg}`,
      updatedHistory: conversationHistory,
    };
  }
}

/**
 * Reset circuit breaker. Call after user acknowledges the error.
 */
export function resetCircuitBreaker(): void {
  consecutiveFailures = 0;
  console.log('[agent] Circuit breaker reset.');
}
