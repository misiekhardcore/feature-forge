/**
 * Configuration schema for the Feature Forge platform.
 *
 * Defines the shape of forge.config data consumed by the CLI, agents,
 * and orchestrators. Values are resolved at session startup from a user-
 * provided config file combined with hard-coded defaults.
 *
 * Uses **TypeBox** schemas for runtime validation and derives TypeScript
 * types via {@link Type.Static}.
 */

import { Type } from "typebox";

// ── Enums ──────────────────────────────────────────────────────────

/**
 * Logging verbosity levels, ordered from least to most verbose.
 */
export enum LogLevel {
  SILENT = "silent",
  ERROR = "error",
  WARN = "warn",
  INFO = "info",
  DEBUG = "debug",
}

/**
 * Provider used to create agent workspaces.
 */
export enum WorkspaceProviderKind {
  /**
   * Create a git worktree from the current repository HEAD.
   * Agents can branch, commit, and push from here.
   */
  GitWorktree = "git-worktree",

  /**
   * Use the current working directory directly (no isolation).
   * Suitable for read-only agents.
   */
  CurrentDir = "current-dir",
}

/**
 * Additional directories to search for flows and agent specs.
 *
 * Paths are relative to the project root (where the config file lives).
 * Built-in directories are always searched first; additional directories
 * are searched second, in the order given.
 */
export const SpecDirectoriesSchema = Type.Object({
  /** Relative paths to directories containing flow packages. */
  flows: Type.Readonly(Type.Optional(Type.Array(Type.String()))),

  /** Relative paths to directories containing declarative agent specs (.md files). */
  agents: Type.Readonly(Type.Optional(Type.Array(Type.String()))),
});

// ── TypeBox Schemas (runtime validation) ───────────────────────────

/**
 * Model override for agents spawned by the platform.
 */
export const AgentModelConfigSchema = Type.Object({
  /** Model identifier (e.g., "claude-sonnet-4-5", "gpt-4o"). */
  model: Type.Readonly(Type.String()),

  /** Optional provider override (e.g., "anthropic", "openai"). */
  provider: Type.Readonly(Type.Optional(Type.String())),

  /** Optional thinking/reasoning level override. */
  thinkingLevel: Type.Readonly(
    Type.Optional(
      Type.Union([
        Type.Literal("off"),
        Type.Literal("minimal"),
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("xhigh"),
      ]),
    ),
  ),
});

/**
 * Named model presets (e.g., "smart", "medium", "dumb").
 * Each value is an {@link AgentModelConfig}.
 */
export const ModelsMapSchema = Type.Readonly(Type.Record(Type.String(), AgentModelConfigSchema));

/**
 * Agent-level configuration overrides.
 */
export const AgentConfigSchema = Type.Object({
  /** Model override for this agent. */
  model: Type.Readonly(Type.Optional(AgentModelConfigSchema)),

  /** Maximum number of tool calls per step. */
  maxToolCalls: Type.Readonly(Type.Optional(Type.Integer({ minimum: 1 }))),

  /** Maximum number of interaction turns before the agent is forced to complete. */
  maxTurns: Type.Readonly(Type.Optional(Type.Integer({ minimum: 1 }))),
});

/**
 * Display-related configuration for the agent viewer overlay.
 *
 * Controls memory-bounded event buffering and raw output truncation
 * in the TUI's agent viewer.
 *
 * All values are optional -- defaults are defined in
 * {@link DEFAULT_FORGE_CONFIG}.
 */
export const DisplayConfigSchema = Type.Object({
  /** Maximum events kept in memory per agent (sliding window FIFO). Defaults to 200. */
  maxAgentEvents: Type.Readonly(Type.Optional(Type.Integer({ minimum: 1, default: 200 }))),

  /** Maximum events buffered before connect() is called (burst protection). Defaults to 2000. */
  maxPreconnectBuffer: Type.Readonly(Type.Optional(Type.Integer({ minimum: 1, default: 2000 }))),

  /** Maximum height of the agent viewer overlay.
   *
   * Accepts either a pixel count (e.g. `30`) or a percentage string
   * (e.g. `"85%"`) relative to the terminal window height.
   * Defaults to `"85%"`.
   */
  maxOverlayHeight: Type.Readonly(
    Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.String()])),
  ),
});

/**
 * Development-mode configuration.
 */
export const DevConfigSchema = Type.Object({
  /** Enable development test commands ("dev-test-*" slash-commands). Defaults to false. */
  enabled: Type.Readonly(Type.Optional(Type.Boolean({ default: false }))),
});

/**
 * Complete configuration schema for the Feature Forge CLI.
 *
 * To extend this schema, add a new `Type.Readonly(...)` field with a JSDoc
 * comment and supply a matching default in {@link DEFAULT_FORGE_CONFIG}.
 *
 * The `agents` map is serialized as a JSON object record; at runtime it
 * is represented as a {@link ReadonlyMap}.
 */
export const ForgeConfigSchema = Type.Object({
  /** Logging verbosity. Defaults to {@link LogLevel.INFO}. */
  logLevel: Type.Readonly(Type.Optional(Type.Enum(LogLevel))),

  /** Prefix for log filenames to distinguish agent logs. Defaults to `"forge"`. */
  logPrefix: Type.Readonly(Type.Optional(Type.String())),

  /** Workspace provider to use when creating agent workspaces. Defaults to `"git-worktree"`. */
  workspaceProvider: Type.Readonly(Type.Optional(Type.Enum(WorkspaceProviderKind))),

  /** Per-agent configuration overrides keyed by agent identifier. Defaults to an empty map. */
  agents: Type.Readonly(Type.Optional(Type.Record(Type.String(), AgentConfigSchema))),

  /** Default agent configuration applied when no per-agent override exists. Defaults to the built-in default agent config. */
  defaultAgent: Type.Readonly(Type.Optional(AgentConfigSchema)),

  /** Directory for log files. Defaults to `.forge/logs` relative to project root. */
  logDir: Type.Readonly(Type.Optional(Type.String())),

  /**
   * Number of days to retain log files before pruning.
   * 0 disables pruning (logs are kept indefinitely). Defaults to 7.
   */
  logRetentionDays: Type.Readonly(Type.Optional(Type.Integer({ minimum: 0 }))),

  /**
   * Maximum bytes per rotated log segment before rolling to `.1`/`.2`.
   * Defaults to 10485760 (10 MB).
   */
  logMaxBytes: Type.Readonly(Type.Optional(Type.Integer({ minimum: 1 }))),

  /**
   * Maximum log files kept by count retention (audit mode: total including
   * the base file). Defaults to 5.
   *
   * CAUTION: in audit mode (the production logger) a value of 0 deletes
   * every file as it is written - the active file itself is evicted by
   * retention, so nothing persists. Only journal mode (no audit ledger)
   * keeps the base file at 0. Prefer a value of at least 1.
   */
  logMaxFiles: Type.Readonly(Type.Optional(Type.Integer({ minimum: 0 }))),

  /**
   * When true, debug-level log entries include full payload data (LLM messages,
   * tool results). When false, only structural fields are logged. Defaults to false.
   */
  logPayloads: Type.Readonly(Type.Optional(Type.Boolean({ default: false }))),

  /** Additional relative paths to symlink into every agent worktree. */
  worktreeSymlinks: Type.Readonly(Type.Optional(Type.Array(Type.String()))),

  /** Default timeout for agent task execution in milliseconds. Defaults to 3600000 (1 hour). */
  taskTimeoutMs: Type.Readonly(Type.Optional(Type.Integer({ minimum: 1 }))),

  /** Maximum retry attempts when an agent's parseJson output is missing a valid JSON block. Defaults to 2. Set to 0 to disable retries. */
  jsonRetryMaxAttempts: Type.Readonly(Type.Optional(Type.Integer({ minimum: 0 }))),

  /** Additional directories for flows and agent specs. */
  specDirectories: Type.Readonly(Type.Optional(SpecDirectoriesSchema)),

  /** Display configuration for the agent viewer overlay. */
  display: Type.Readonly(Type.Optional(DisplayConfigSchema)),

  /** Named model presets ("smart", "medium", "dumb"). Each value is an AgentModelConfig. */
  models: Type.Readonly(Type.Optional(ModelsMapSchema)),

  /** Default model preset key. References a key in `models`. Undefined means no preset default — the system falls back to `defaultAgent.model` or a hard-coded fallback. */
  defaultModel: Type.Readonly(Type.Optional(Type.String())),

  /**
   * Absolute path to the pi CLI entry (`dist/cli.js`) used to spawn sub-agents.
   * Defaults to the pi copy bundled with feature-forge — set this to pin
   * children to a specific pi install.
   */
  piCli: Type.Readonly(Type.Optional(Type.String())),

  /** Development-mode configuration. */
  dev: Type.Readonly(Type.Optional(DevConfigSchema)),

  /**
   * Root directory for forge assets (agents, flows, skills, config).
   *
   * Relative paths are resolved against the project root.
   * Accepts `~/.forge` for a global (cross-project) forge directory.
   * Defaults to `".forge"`.
   */
  forgeDir: Type.Readonly(Type.Optional(Type.String())),
});

// ── Derived TypeScript types ───────────────────────────────────────

/** TypeScript type derived from {@link AgentModelConfigSchema}. */
export type AgentModelConfig = Type.Static<typeof AgentModelConfigSchema>;

/**
 * Resolved model configuration returned by {@link resolveModel}.
 * Extends {@link AgentModelConfig} with a `resolved` flag indicating
 * whether the model was found as a preset in the models map.
 */
export type ResolvedModelConfig = AgentModelConfig & {
  resolved: boolean;
};

/** TypeScript type derived from {@link ModelsMapSchema}. */
export type ModelsMap = Type.Static<typeof ModelsMapSchema>;

/** TypeScript type derived from {@link AgentConfigSchema}. */
export type AgentConfig = Type.Static<typeof AgentConfigSchema>;

/** TypeScript type derived from {@link SpecDirectoriesSchema}. */
export type SpecDirectories = Type.Static<typeof SpecDirectoriesSchema>;

/** TypeScript type derived from {@link DisplayConfigSchema}. */
export type DisplayConfig = Type.Static<typeof DisplayConfigSchema>;

/** TypeScript type derived from {@link DevConfigSchema}. */
export type DevConfig = Type.Static<typeof DevConfigSchema>;

/**
 * TypeScript type derived from {@link ForgeConfigSchema}.
 *
 * The `agents` field is typed as `ReadonlyMap` rather than `Record`
 * to enforce immutability at runtime.
 *
 * Schema-optional fields that are always present after resolution
 * (`logLevel`, `workspaceProvider`, `agents`, `defaultAgent`) are
 * re-declared as required: {@link resolveConfig} fills every one of
 * them from `DEFAULT_FORGE_CONFIG` before a config is exposed.
 */
export type ForgeConfig = Omit<
  Type.Static<typeof ForgeConfigSchema>,
  "agents" | "models" | "defaultModel" | "piCli" | "logLevel" | "workspaceProvider" | "defaultAgent"
> & {
  readonly logLevel: LogLevel;
  readonly workspaceProvider: WorkspaceProviderKind;
  readonly agents: ReadonlyMap<string, AgentConfig>;
  readonly defaultAgent: AgentConfig;
  readonly models: Readonly<Record<string, AgentModelConfig>>;
  readonly defaultModel: string | undefined;
  readonly piCli: string | undefined;
  readonly forgeDir: string | undefined;
};
