export enum BUILT_IN_TOOLS {
  READ = "read",
  BASH = "bash",
  EDIT = "edit",
  WRITE = "write",
  GREP = "grep",
  FIND = "find",
  LS = "ls",
}

/**
 * Named presets for commonly used tool configurations.
 *
 * Every spec subclass picks from these constants instead of
 * repeating inline string arrays.
 */
export const TOOL_PRESETS = {
  /** read, grep, ls — safe for read-only research agents. */
  readOnly: [BUILT_IN_TOOLS.READ, BUILT_IN_TOOLS.GREP, BUILT_IN_TOOLS.LS] as const,

  /** read, bash, write, edit, grep, ls — full access for coding agents. */
  fullAccess: [
    BUILT_IN_TOOLS.READ,
    BUILT_IN_TOOLS.BASH,
    BUILT_IN_TOOLS.WRITE,
    BUILT_IN_TOOLS.EDIT,
    BUILT_IN_TOOLS.GREP,
    BUILT_IN_TOOLS.LS,
  ] as const,

  /** read, grep, ls — for code review agents that inspect code quality, architecture, and standards. */
  reviewOnly: [BUILT_IN_TOOLS.READ, BUILT_IN_TOOLS.GREP, BUILT_IN_TOOLS.LS] as const,

  /** read, bash, grep, ls — for verification agents that check acceptance criteria and run e2e tests. */
  verify: [
    BUILT_IN_TOOLS.READ,
    BUILT_IN_TOOLS.BASH,
    BUILT_IN_TOOLS.GREP,
    BUILT_IN_TOOLS.LS,
  ] as const,
} as const;

export type ToolPresetName = keyof typeof TOOL_PRESETS;
