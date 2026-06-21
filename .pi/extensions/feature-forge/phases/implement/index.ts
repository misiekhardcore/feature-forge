import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Phase } from "../base";
import { State } from "../../state";
import { AgentSpawner } from "../../pi-spawner";
import { ImplementCoordinator } from "./coordinator";

const __dir = dirname(fileURLToPath(import.meta.url));

export class ImplementPhase extends Phase {
  readonly name = "implement";
  readonly description = "Build, review, verify, and open a PR from an approved issue";

  constructor(pi: ExtensionAPI) {
    super(pi, __dir);
  }

  async handler(args: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
    const sessionEntries = ctx.sessionManager?.getEntries() ?? [];
    const issueRef = State.getInstance().resolveIssueRef(args, sessionEntries);

    if (!issueRef) {
      ctx.ui.notify(
        "No issue found. Usage: /implement <issue-url|issue-number> or run /discover + /define first.",
        "error",
      );
      return;
    }

    ctx.ui.notify("Starting implementation pipeline...", "info");

    const spawner = new AgentSpawner();
    const coordinator = new ImplementCoordinator(issueRef, spawner);

    const result = await coordinator.run((msg) => {
      ctx.ui.notify(msg, "info");
    });

    if (result.prUrl) {
      ctx.ui.notify(`PR opened: ${result.prUrl}`, "info");
    } else {
      ctx.ui.notify("Implementation pipeline finished but no PR was created.", "warning");
    }
  }
}
