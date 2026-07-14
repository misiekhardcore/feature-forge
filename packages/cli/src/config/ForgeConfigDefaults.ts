/**
 * Default configuration values for the Feature Forge CLI.
 *
 * These are used as fallbacks when the user does not provide a value
 * in their forge.config file (or when no config file is found at all).
 */

import type { AgentConfig, AgentModelConfig, ForgeConfig } from "./ForgeConfigSchema";
import { LogLevel, WorkspaceProviderKind } from "./ForgeConfigSchema";

/**
 * Default agent configuration.
 *
 * The `model` field provides a sensible fallback when no model override
 * is specified for a particular agent.
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = Object.freeze({
  model: Object.freeze({ model: "gpt-4" }),
  maxToolCalls: 40,
  maxTurns: 100,
});

/**
 * Frozen default configuration for the Feature Forge platform.
 *
 * Every consumer should treat this as immutable. Spread or clone before
 * mutating for a specific session.
 */
export const DEFAULT_FORGE_CONFIG: Required<ForgeConfig> = Object.freeze({
  logLevel: LogLevel.INFO,
  workspaceProvider: WorkspaceProviderKind.GitWorktree,
  agents: new Map<string, AgentConfig>(),
  defaultAgent: DEFAULT_AGENT_CONFIG,
  logDir: ".forge/logs",
  worktreeSymlinks: [],
  taskTimeoutMs: 60 * 60 * 1000,
  specDirectories: { flows: [], agents: [] },
  display: {
    maxRawLength: 500,
    maxAgentEvents: 200,
    maxPreconnectBuffer: 2000,
  },
});

/**
 * Merge a partial user-provided config with the defaults.
 *
 * Returns a new {@link ForgeConfig} object — neither input is mutated.
 * The returned config's `agents` map and `defaultAgent` are decoupled
 * from the input references to prevent shared-reference mutation.
 *
 * @param overrides — Partial config values from the user (may come from a
 *   forge.config file or inline options).
 * @returns A fully resolved {@link ForgeConfig}.
 */
export function resolveConfig(overrides: Partial<ForgeConfig>): ForgeConfig {
  // Deep-clone the agents map to decouple from the input reference.
  // Each entry value is spread into a fresh object so mutations to the
  // input's `AgentConfig` objects don't propagate to the resolved config.
  const resolvedAgents: Map<string, AgentConfig> = new Map();
  if (overrides.agents) {
    for (const [key, agentCfg] of overrides.agents) {
      resolvedAgents.set(key, { ...agentCfg });
    }
  } else {
    // Use frozen defaults — no need to clone since defaults are frozen.
    for (const [key, agentCfg] of DEFAULT_FORGE_CONFIG.agents) {
      resolvedAgents.set(key, agentCfg);
    }
  }

  return {
    logLevel: overrides.logLevel ?? DEFAULT_FORGE_CONFIG.logLevel,
    workspaceProvider: overrides.workspaceProvider ?? DEFAULT_FORGE_CONFIG.workspaceProvider,
    agents: resolvedAgents,
    defaultAgent: {
      // Deep-clone model to decouple from input reference
      model: overrides.defaultAgent?.model
        ? { ...overrides.defaultAgent.model }
        : ({ ...DEFAULT_AGENT_CONFIG.model } as AgentModelConfig),
      maxToolCalls: overrides.defaultAgent?.maxToolCalls ?? DEFAULT_AGENT_CONFIG.maxToolCalls,
      maxTurns: overrides.defaultAgent?.maxTurns ?? DEFAULT_AGENT_CONFIG.maxTurns,
    },
    logDir: overrides.logDir ?? DEFAULT_FORGE_CONFIG.logDir,
    worktreeSymlinks: overrides.worktreeSymlinks ?? DEFAULT_FORGE_CONFIG.worktreeSymlinks,
    taskTimeoutMs: overrides.taskTimeoutMs ?? DEFAULT_FORGE_CONFIG.taskTimeoutMs,
    specDirectories: overrides.specDirectories ?? DEFAULT_FORGE_CONFIG.specDirectories,
    display: overrides.display ?? DEFAULT_FORGE_CONFIG.display,
  };
}
