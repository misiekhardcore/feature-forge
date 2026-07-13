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
  Silent = "silent",
  Error = "error",
  Warn = "warn",
  Info = "info",
  Debug = "debug",
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
});

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
 * Complete configuration schema for the Feature Forge CLI.
 *
 * To extend this schema, add a new `Type.Readonly(...)` field with a JSDoc
 * comment and supply a matching default in {@link DEFAULT_FORGE_CONFIG}.
 *
 * The `agents` map is serialized as a JSON object record; at runtime it
 * is represented as a {@link ReadonlyMap}.
 */
export const ForgeConfigSchema = Type.Object({
  /** Logging verbosity. Defaults to {@link LogLevel.Info}. */
  logLevel: Type.Readonly(Type.Enum(LogLevel)),

  /** Workspace provider to use when creating agent workspaces. */
  workspaceProvider: Type.Readonly(Type.Enum(WorkspaceProviderKind)),

  /** Per-agent configuration overrides keyed by agent identifier. */
  agents: Type.Readonly(Type.Record(Type.String(), AgentConfigSchema)),

  /** Default agent configuration applied when no per-agent override exists. */
  defaultAgent: Type.Readonly(AgentConfigSchema),

  /** Directory for log files. Defaults to `.forge/logs` relative to project root. */
  logDir: Type.Readonly(Type.Optional(Type.String())),

  /** Additional relative paths to symlink into every agent worktree. */
  worktreeSymlinks: Type.Readonly(Type.Optional(Type.Array(Type.String()))),

  /** Default timeout for agent task execution in milliseconds. Defaults to 3600000 (1 hour). */
  taskTimeoutMs: Type.Readonly(Type.Optional(Type.Integer({ minimum: 1 }))),

  /** Additional directories for flows and agent specs. */
  specDirectories: Type.Readonly(Type.Optional(SpecDirectoriesSchema)),
});

// ── Derived TypeScript types ───────────────────────────────────────

/** TypeScript type derived from {@link AgentModelConfigSchema}. */
export type AgentModelConfig = Type.Static<typeof AgentModelConfigSchema>;

/** TypeScript type derived from {@link AgentConfigSchema}. */
export type AgentConfig = Type.Static<typeof AgentConfigSchema>;

/** TypeScript type derived from {@link SpecDirectoriesSchema}. */
export type SpecDirectories = Type.Static<typeof SpecDirectoriesSchema>;

/**
 * TypeScript type derived from {@link ForgeConfigSchema}.
 *
 * The `agents` field is typed as `ReadonlyMap` rather than `Record`
 * to enforce immutability at runtime.
 */
export type ForgeConfig = Omit<Type.Static<typeof ForgeConfigSchema>, "agents"> & {
  readonly agents: ReadonlyMap<string, AgentConfig>;
};
