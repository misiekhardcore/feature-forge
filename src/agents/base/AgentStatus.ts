/**
 * Possible states in an agent's lifecycle.
 *
 * Per family:
 * - Subprocess: Spawned → Running → Completed | Failed; Spawned → Failed;
 *   any → Cancelled on destroy.
 * - In-session:   Spawned → Running → Cancelled on destroy.
 */
export enum AgentStatus {
  /** Agent specification allocated, workspace being prepared */
  Spawned = "Spawned",

  /** (Subprocess) Agent is actively processing a task, (In-session) Agent persona+task mounted into the live session */
  Running = "Running",

  /** (Subprocess) Agent completed its task successfully, result is available */
  Completed = "Completed",

  /** Agent encountered an error and stopped */
  Failed = "Failed",

  /** Agent has been externally interrupted */
  Cancelled = "Cancelled",
}
