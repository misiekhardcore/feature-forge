/**
 * Possible states in an agent's lifecycle.
 *
 * Per family:
 * - Subprocess: Spawned → Running → Completed | Failed; Spawned → Failed;
 *   any → Cancelled on destroy.
 * - In-session:   Spawned → Mounted → Cancelled on destroy.
 *
 * `Mounted` distinguishes an in-session agent that is driving the live
 * session from a subprocess agent that is processing a delegated task.
 */
export enum AgentStatus {
  /** Agent specification allocated, workspace being prepared */
  Spawned = "Spawned",

  /** (Subprocess) Agent is actively processing a task */
  Running = "Running",

  /** (In-session) Agent persona+task mounted into the live session */
  Mounted = "Mounted",

  /** (Subprocess) Agent completed its task successfully, result is available */
  Completed = "Completed",

  /** Agent encountered an error and stopped */
  Failed = "Failed",

  /** Agent has been externally interrupted */
  Cancelled = "Cancelled",
}
