// @binancebuddy/ai — AI agent, tools, prompts, research
export { runAgent, resetCircuitBreaker, getCircuitBreakerStatus } from './agent.js';
export { runResearch, getLatestReport, isReportFresh, startResearchLoop, researchCategory, researchProtocol, runDeepResearch, getDuneUsage } from './research.js';
export { buildSystemPrompt } from './prompts/system.js';
export { getTools, executeTool, ALL_TOOLS } from './tools/index.js';
export { discoverNewProtocols, getRegistry, getRegistryEntry, getLastDiscoveryRun } from './discovery.js';

// Tool exports (for server route wiring)
export { getAlerts } from './tools/alerts.js';
