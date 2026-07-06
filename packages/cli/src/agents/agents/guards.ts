import type { Agent } from "./Agent";
import type { SubprocessAgent } from "./SubprocessAgent";

/**
 * Structural type guard narrowing the slim {@link Agent} to its subprocess
 * family.
 *
 * The base `Agent` exposes the common {@link Agent.specification} but
 * deliberately does not surface the *interaction* contract (`executeTask` /
 * `mount`) — see ADR 0007. Consumers that need the subprocess interaction
 * methods on a base-typed `Agent` (e.g. the IPC subprocess path) narrow with
 * this guard rather than forcing those methods back onto the base.
 *
 * Structural rather than `instanceof` so test doubles and IPC mock agents —
 * which present the same shape without extending the class — also narrow.
 */
export function isSubprocessAgent(agent: Agent): agent is SubprocessAgent {
  return "executeTask" in agent && typeof agent.executeTask === "function";
}
