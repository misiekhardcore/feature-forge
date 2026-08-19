export enum BUILT_IN_TOOLS {
  READ = "read",
  BASH = "bash",
  EDIT = "edit",
  WRITE = "write",
  GREP = "grep",
  FIND = "find",
  LS = "ls",
}

/** read, grep, ls - safe for read-only research agents. */
const READ_ONLY_TOOLS = [BUILT_IN_TOOLS.READ, BUILT_IN_TOOLS.GREP, BUILT_IN_TOOLS.LS] as const;

/**
 * Named presets for commonly used tool configurations.
 *
 * Every spec subclass picks from these constants instead of
 * repeating inline string arrays.
 */
export const TOOL_PRESETS = {
  /** read, grep, ls - safe for read-only research agents. */
  readOnly: READ_ONLY_TOOLS,

  /** read, bash, write, edit, grep, ls - full access for coding agents. */
  fullAccess: [
    BUILT_IN_TOOLS.READ,
    BUILT_IN_TOOLS.BASH,
    BUILT_IN_TOOLS.WRITE,
    BUILT_IN_TOOLS.EDIT,
    BUILT_IN_TOOLS.GREP,
    BUILT_IN_TOOLS.LS,
  ] as const,

  /** Alias of {@link TOOL_PRESETS.readOnly} - for review agents that inspect code without mutating it. */
  reviewOnly: READ_ONLY_TOOLS,

  /** read, bash, grep, ls - for verification agents that check acceptance criteria and run e2e tests. */
  verify: [
    BUILT_IN_TOOLS.READ,
    BUILT_IN_TOOLS.BASH,
    BUILT_IN_TOOLS.GREP,
    BUILT_IN_TOOLS.LS,
  ] as const,
} as const;

export type ToolPresetName = keyof typeof TOOL_PRESETS;
