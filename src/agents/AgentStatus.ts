/**
 * Possible states in an agent's lifecycle.
 * Transitions: Spawned → Running → Completed | Failed
 *                         → Running → Failed
 *             Spawned → Failed (if spawn itself fails)
 */
export enum AgentStatus {
  /** Agent specification allocated, workspace being prepared */
  Spawned = "Spawned",

  /** Agent is actively processing a task */
  Running = "Running",

  /** Agent completed its task successfully, result is available */
  Completed = "Completed",

  /** Agent encountered an error and stopped */
  Failed = "Failed",

  /** Agent has been externally interrupted */
  Cancelled = "Cancelled",
}
