import { AgentSpecification } from "../specifications";
import type { Agent } from "./Agent";
import type { SubprocessAgent } from "./SubprocessAgent";

/**
 * Structural type guards and small accessors over the slim {@link Agent}.
 *
 * The base `Agent` deliberately does not expose `specification` or any
 * family-specific method (see ADR 0007). Consumers that need those on a
 * base-typed `Agent` (e.g. fleet listing, the IPC subprocess path) narrow
 * with these guards rather than forcing the members back onto the base.
 */

/**
 * True when `agent` is a {@link SubprocessAgent} (carries `executeTask`).
 *
 * Structural rather than `instanceof` so test doubles and IPC mock agents —
 * which present the same shape without extending the class — also narrow.
 */
export function isSubprocessAgent(agent: Agent): agent is SubprocessAgent {
  return typeof (agent as { executeTask?: unknown }).executeTask === "function";
}

/**
 * Resolve an agent's role from its specification, falling back to `"unknown"`
 * for an agent that carries no specification on the base contract.
 */
export function getRole(agent: Agent): string {
  return (agent as { specification?: AgentSpecification }).specification?.role ?? "unknown";
}
