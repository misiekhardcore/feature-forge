import { ActiveFlowRegistry } from "@feature-forge/core/flows";
import { describe, expect, it } from "vitest";

import { makeMockPi, makeMockTypedEventBus } from "../test-utils";
import { DestroyAgentTool } from "./DestroyAgentTool";
import { GetAgentResultTool } from "./GetAgentResultTool";
import { ListAgentsTool } from "./ListAgentsTool";
import { SendTaskTool } from "./SendTaskTool";
import { SetFlowParamTool } from "./SetFlowParamTool";
import { SetSessionNameTool } from "./SetSessionNameTool";
import { SpawnAgentTool } from "./SpawnAgentTool";

/**
 * Composition-boundary guard for the seven TUI-rendered tools.
 *
 * At the composition root (packages/cli/src/index.ts) every tool is handed
 * to pi through ToolRegistry typed as the base core `Tool`, whose type
 * carries no render members - so registration alone cannot enforce the
 * renderer trio. Each class's own `implements RenderableTool` clause makes
 * omission a compile error inside the tool file, but that enforcement is
 * advisory at the registration boundary: this test pins the trio on the
 * exact instances pi receives. A tool that declares `renderShell: "self"`
 * without a working `renderCall`/`renderResult` pair would silently lose
 * boxed rendering (the #232/#218 regression class) with no compile error
 * at the boundary, so keep this list in sync with the registrations in
 * packages/cli/src/index.ts.
 */
describe("RenderableTool composition boundary", () => {
  const renderable = [
    { name: "spawn_agent", tool: new SpawnAgentTool(null) },
    { name: "send_task", tool: new SendTaskTool(null) },
    { name: "get_agent_result", tool: new GetAgentResultTool(null) },
    { name: "destroy_agent", tool: new DestroyAgentTool(null) },
    { name: "list_agents", tool: new ListAgentsTool(null) },
    {
      name: "set_flow_param",
      tool: new SetFlowParamTool(new ActiveFlowRegistry(), makeMockTypedEventBus()),
    },
    { name: "set_session_name", tool: new SetSessionNameTool(makeMockPi()) },
  ];

  it("mirrors the composition root's seven tool registrations", () => {
    expect(renderable.map(({ name }) => name)).toEqual([
      "spawn_agent",
      "send_task",
      "get_agent_result",
      "destroy_agent",
      "list_agents",
      "set_flow_param",
      "set_session_name",
    ]);
  });

  it("ships a full render trio for every tool pi receives", () => {
    for (const { name, tool } of renderable) {
      expect(tool.renderShell, `${name}: renderShell`).toBe("self");
      expect(typeof tool.renderCall, `${name}: renderCall`).toBe("function");
      expect(typeof tool.renderResult, `${name}: renderResult`).toBe("function");
    }
  });
});
