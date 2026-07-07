/**
 * Environment variable name for the bash command allowlist.
 *
 * Set by PiSubprocessAgentFactory on child process environments and read by
 * the session_start handler in index.ts to install bash restrictions on
 * child agents.
 */
export const FORGE_BASH_ALLOWLIST = "FORGE_BASH_ALLOWLIST";
