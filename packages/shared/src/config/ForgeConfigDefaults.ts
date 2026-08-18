/**
 * Default configuration values for the Feature Forge CLI.
 *
 * These are used as fallbacks when the user does not provide a value
 * in their forge.config file (or when no config file is found at all).
 *
 * The canonical defaults live in `forge-config.defaults.json` — the
 * same file the setup script scaffolds into `.forge/config.json`.
 * This module maps the JSON's string enum values onto typed constants.
 */

import defaultsJson from "./forge-config.defaults.json";
import type { AgentConfig, ForgeConfig, SpecDirectories } from "./ForgeConfigSchema";
import { LogLevel, WorkspaceProviderKind } from "./ForgeConfigSchema";

/**
 * Recursively freeze an object, array, or Map (including nested values).
 *
 * `Object.freeze` is shallow — callers could otherwise mutate nested
 * structures of the frozen defaults (e.g. `worktreeSymlinks.push(...)`
 * or `display.maxAgentEvents = 1`) and corrupt the process-wide defaults.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (value instanceof Map) {
    for (const entry of value.values()) {
      deepFreeze(entry);
    }
  } else {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Deep-clone a shared nested structure so a resolved config never shares
 * references with the frozen defaults (or the caller's own overrides).
 */
function cloneArray<T>(value: readonly T[]): T[] {
  return [...value];
}

function cloneSpecDirectories(value: SpecDirectories): SpecDirectories {
  return {
    flows: cloneArray(value.flows ?? []),
    agents: cloneArray(value.agents ?? []),
  };
}

/**
 * Default agent configuration.
 *
 * The `model` field provides a sensible fallback when no model override
 * is specified for a particular agent.
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = deepFreeze({
  maxToolCalls: defaultsJson.defaultAgent.maxToolCalls,
  maxTurns: defaultsJson.defaultAgent.maxTurns,
});

/**
 * Build the frozen default configuration from the canonical JSON file.
 *
 * String enum values in the JSON are cast to their typed enum members
 * and the `agents` record is converted to a `Map` (the runtime shape
 * of {@link ForgeConfig}). The result is deep-frozen — nested arrays,
 * objects, and map values are frozen too.
 */
function createDefaultConfig(): Required<ForgeConfig> {
  const agents = new Map<string, AgentConfig>(Object.entries(defaultsJson.agents));

  return deepFreeze({
    logLevel: defaultsJson.logLevel as LogLevel,
    logPrefix: defaultsJson.logPrefix,
    workspaceProvider: defaultsJson.workspaceProvider as WorkspaceProviderKind,
    agents,
    defaultAgent: DEFAULT_AGENT_CONFIG,
    logDir: defaultsJson.logDir,
    logRetentionDays: defaultsJson.logRetentionDays,
    logPayloads: defaultsJson.logPayloads,
    worktreeSymlinks: defaultsJson.worktreeSymlinks,
    taskTimeoutMs: defaultsJson.taskTimeoutMs,
    jsonRetryMaxAttempts: defaultsJson.jsonRetryMaxAttempts,
    specDirectories: defaultsJson.specDirectories,
    display: defaultsJson.display,
    models: defaultsJson.models,
    defaultModel: undefined,
    dev: defaultsJson.dev,
    forgeDir: defaultsJson.forgeDir,
  });
}

/**
 * Frozen default configuration for the Feature Forge platform.
 *
 * Every consumer should treat this as immutable. Spread or clone before
 * mutating for a specific session.
 */
export const DEFAULT_FORGE_CONFIG: Required<ForgeConfig> = createDefaultConfig();

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

  // When dev mode is enabled and no explicit log level is configured,
  // force DEBUG to surface all diagnostic output.
  const devEnabled = overrides.dev?.enabled ?? false;
  const logLevel =
    overrides.logLevel ?? (devEnabled ? LogLevel.DEBUG : DEFAULT_FORGE_CONFIG.logLevel);

  return {
    logLevel,
    logPrefix: overrides.logPrefix ?? DEFAULT_FORGE_CONFIG.logPrefix,
    workspaceProvider: overrides.workspaceProvider ?? DEFAULT_FORGE_CONFIG.workspaceProvider,
    agents: resolvedAgents,
    defaultAgent: ((): AgentConfig => {
      const modelOverride = overrides.defaultAgent?.model;
      const modelDefault = DEFAULT_AGENT_CONFIG.model;
      return {
        maxToolCalls: overrides.defaultAgent?.maxToolCalls ?? DEFAULT_AGENT_CONFIG.maxToolCalls,
        maxTurns: overrides.defaultAgent?.maxTurns ?? DEFAULT_AGENT_CONFIG.maxTurns,
        ...(modelOverride || modelDefault
          ? { model: modelOverride ? { ...modelOverride } : { ...modelDefault! } }
          : {}),
      };
    })(),
    logDir: overrides.logDir ?? DEFAULT_FORGE_CONFIG.logDir,
    logRetentionDays: overrides.logRetentionDays ?? DEFAULT_FORGE_CONFIG.logRetentionDays,
    logPayloads: overrides.logPayloads ?? DEFAULT_FORGE_CONFIG.logPayloads,
    // Deep-clone shared nested structures so mutating a resolved config
    // never corrupts DEFAULT_FORGE_CONFIG (or the caller's own overrides).
    worktreeSymlinks: cloneArray(
      overrides.worktreeSymlinks ?? DEFAULT_FORGE_CONFIG.worktreeSymlinks,
    ),
    taskTimeoutMs: overrides.taskTimeoutMs ?? DEFAULT_FORGE_CONFIG.taskTimeoutMs,
    jsonRetryMaxAttempts:
      overrides.jsonRetryMaxAttempts ?? DEFAULT_FORGE_CONFIG.jsonRetryMaxAttempts,
    specDirectories: cloneSpecDirectories(
      overrides.specDirectories ?? DEFAULT_FORGE_CONFIG.specDirectories,
    ),
    models: overrides.models
      ? Object.fromEntries(
          Object.entries(overrides.models).map(([key, modelCfg]) => [key, { ...modelCfg }]),
        )
      : DEFAULT_FORGE_CONFIG.models,
    defaultModel: overrides.defaultModel ?? DEFAULT_FORGE_CONFIG.defaultModel,
    display: { ...(overrides.display ?? DEFAULT_FORGE_CONFIG.display) },
    dev: { ...(overrides.dev ?? DEFAULT_FORGE_CONFIG.dev) },
    forgeDir: overrides.forgeDir ?? DEFAULT_FORGE_CONFIG.forgeDir,
  };
}
