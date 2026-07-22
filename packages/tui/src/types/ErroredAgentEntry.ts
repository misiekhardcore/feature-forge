import type { AgentEntryBase } from "./AgentEntryBase";

/**
 * Agent entry for an agent that has errored.
 *
 * Status is "error" and includes error message and stack trace.
 */
export interface ErroredAgentEntry extends AgentEntryBase {
  /** Lifecycle status - always "error" for errored agents. */
  status: "error";
  /** Error message from the failed agent. */
  errorMessage: string;
  /** Optional stack trace for the error. */
  stack?: string;
  /** Optional summary of the error. */
  summary?: string;
}
