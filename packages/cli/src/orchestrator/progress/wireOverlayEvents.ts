import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { AgentStatus } from "@feature-forge/shared";

import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { AgentViewerOverlay } from "./AgentViewerOverlay";

/**
 * Create event subscriptions that feed an overlay with live agent data.
 *
 * Returns subscriptions and a {@code connect} callback.  Callers construct the
 * overlay after subscriptions are established and then call {@code connect}
 * to replay buffered events, set the stream directory, and populate initial
 * agent entries from the supervisor.
 */
export function wireOverlayEvents(params: { eventBus: EventBus; supervisor: AgentSupervisor }): {
  connect: (viewer: AgentViewerOverlay, streamDir: string) => void;
  unsubs: Array<() => void>;
} {
  const { eventBus, supervisor } = params;

  const channels = [
    "feature-forge:agent-stream",
    "feature-forge:agent-started",
    "feature-forge:agent-done",
  ] as const;

  const eventBuffer: Array<{
    agentId: string;
    event?: AgentEvent;
    status?: string;
    passed?: boolean;
    summary?: string;
  }> = [];
  let connected = false;

  const deliverStatusEvent = (
    viewer: AgentViewerOverlay,
    agentId: string,
    mappedStatus: string,
    passed?: boolean,
    eventSummary?: string,
  ) => {
    const agent = supervisor.getAgent(agentId);
    const summary =
      eventSummary ??
      (agent ? `${agent.specification.role} — ${agent.status}` : "Agent disconnected");
    viewer.update({
      id: agentId,
      status: mappedStatus,
      passed,
      summary,
      role: agent?.specification.role,
      elapsed: agent ? AgentViewerOverlay.formatElapsed(agent.createdAt) : undefined,
    });
  };

  const unsubs = channels.map((channel) =>
    eventBus.on(channel, (data) => {
      const payload = data as {
        details?: {
          agentId?: string;
          event?: unknown;
          passed?: boolean;
          summary?: string;
        };
      };
      const agentId = payload.details?.agentId;
      if (!agentId) return;

      if (channel === "feature-forge:agent-stream" && payload.details?.event) {
        if (connected) {
          viewer.pushStreamEvent(agentId, payload.details.event as AgentEvent);
        } else {
          eventBuffer.push({
            agentId,
            event: payload.details.event as AgentEvent,
          });
        }
      } else if (
        channel === "feature-forge:agent-started" ||
        channel === "feature-forge:agent-done"
      ) {
        const mappedStatus = AgentViewerOverlay.mapStatus(
          supervisor.getAgent(agentId)?.status ?? AgentStatus.Spawned,
        );
        const passed = payload.details?.passed;
        const eventSummary = payload.details?.summary;
        if (connected) {
          deliverStatusEvent(viewer, agentId, mappedStatus, passed, eventSummary);
        } else {
          eventBuffer.push({
            agentId,
            status: mappedStatus,
            passed,
            summary: eventSummary,
          });
        }
      }
    }),
  );

  let viewer!: AgentViewerOverlay;

  const connect = (v: AgentViewerOverlay, streamDir: string) => {
    viewer = v;
    connected = true;

    for (const item of eventBuffer) {
      if (item.status) {
        deliverStatusEvent(viewer, item.agentId, item.status, item.passed, item.summary);
      } else if (item.event) {
        viewer.pushStreamEvent(item.agentId, item.event);
      }
    }
    eventBuffer.length = 0;

    viewer.setStreamDir(streamDir);

    viewer.prepopulateStreamFiles(streamDir);

    for (const agent of supervisor.getAllAgents()) {
      const status = AgentViewerOverlay.mapStatus(agent.status);
      viewer.update({
        id: agent.id,
        status,
        summary: `${agent.specification.role} — ${agent.status}`,
        role: agent.specification.role,
        elapsed: AgentViewerOverlay.formatElapsed(agent.createdAt),
      });
    }
  };

  return { connect, unsubs };
}
