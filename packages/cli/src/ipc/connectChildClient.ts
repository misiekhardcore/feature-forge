import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { ChildSocketClient } from "./ChildSocketClient";

/**
 * Connect to the parent's Unix socket and wire up push event forwarding.
 *
 * Child processes connect to `FORGE_PARENT_SOCKET`; the root parent
 * connects to its own server for loopback.  In both cases agent-update
 * push events are forwarded as display messages via the ExtensionAPI.
 */
export async function connectChildClient(
  socketPath: string,
  pi: ExtensionAPI,
): Promise<ChildSocketClient> {
  const client = new ChildSocketClient(socketPath);
  await client.connect();

  client.onPush((event) => {
    if (event.type === "agent_update") {
      const { agentId, status, result } = event.payload;
      const message = `**Agent ${agentId}** — ${status}${result ? `:\n\n${result}` : ""}`;
      pi.sendMessage({
        customType: "agent_update",
        content: [{ type: "text", text: message }],
        display: true,
        details: event.payload,
      });
    }
  });

  return client;
}
