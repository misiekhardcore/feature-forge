import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { PiSpawner } from "../../pi-spawner";
import { SubAgent } from "./agents/base";
import type { SubAgentContext } from "./agents/types";
import { BuildAgent } from "./agents/build";
import { ReviewAgent } from "./agents/review";
import { VerifyAgent } from "./agents/verify";
import { PrAgent } from "./agents/pr";

const AGENTS_DIR = dirname(fileURLToPath(import.meta.url)) + "/agents";

export interface CoordinatedAgents {
  build: SubAgent;
  review: SubAgent;
  verify: SubAgent;
  pr: SubAgent;
}

export interface CoordinatorResult {
  prUrl?: string;
}

const MAX_CYCLES = 5;

/**
 * Orchestrates the build → review → verify cycle loop, then opens a PR.
 * Runs entirely in TypeScript — no coordinator prompt sent to the LLM.
 */
export class ImplementCoordinator {
  private readonly agents: CoordinatedAgents;

  constructor(
    private readonly issueRef: string,
    private readonly spawner: PiSpawner,
    agents?: Partial<CoordinatedAgents>,
  ) {
    this.agents = {
      build: agents?.build ?? new BuildAgent(AGENTS_DIR, spawner),
      review: agents?.review ?? new ReviewAgent(AGENTS_DIR, spawner),
      verify: agents?.verify ?? new VerifyAgent(AGENTS_DIR, spawner),
      pr: agents?.pr ?? new PrAgent(AGENTS_DIR, spawner),
    };
  }

  async run(onProgress?: (msg: string) => void): Promise<CoordinatorResult> {
    let previousFindings: string | undefined;
    let worktreePath: string | undefined;
    let branch: string | undefined;

    // ---- Cycle loop ----
    for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
      onProgress?.(`Cycle ${cycle}/${MAX_CYCLES}: building...`);

      // Build
      const ctx: SubAgentContext = {
        issueRef: this.issueRef,
        cycleNumber: cycle,
        previousFindings,
      };

      const buildResult = await this.agents.build.execute(ctx);
      worktreePath = buildResult.worktreePath;
      branch = buildResult.branch;

      onProgress?.(`Cycle ${cycle}/${MAX_CYCLES}: reviewing...`);

      // Review
      const reviewCtx: SubAgentContext = {
        issueRef: this.issueRef,
        cycleNumber: cycle,
        worktreePath,
        branch,
      };
      const reviewResult = await this.agents.review.execute(reviewCtx);

      onProgress?.(`Cycle ${cycle}/${MAX_CYCLES}: verifying...`);

      // Verify
      const verifyCtx: SubAgentContext = {
        issueRef: this.issueRef,
        cycleNumber: cycle,
        worktreePath,
        branch,
        reviewFindings: reviewResult.findings,
      };
      const verifyResult = await this.agents.verify.execute(verifyCtx);

      if (verifyResult.status === "pass") {
        onProgress?.(`Cycle ${cycle}/${MAX_CYCLES}: passed!`);
        break;
      }

      previousFindings = verifyResult.remainingIssues;
      onProgress?.(`Cycle ${cycle}/${MAX_CYCLES}: failed — ${previousFindings}`);

      if (cycle === MAX_CYCLES) {
        onProgress?.(`All ${MAX_CYCLES} cycles exhausted with failures. Aborting.`);
        return {};
      }
    }

    // ---- PR ----
    if (!worktreePath || !branch) {
      onProgress?.("No worktree or branch from build — cannot open PR.");
      return {};
    }

    onProgress?.("Opening PR...");

    const prCtx: SubAgentContext = {
      issueRef: this.issueRef,
      cycleNumber: MAX_CYCLES,
      worktreePath,
      branch,
    };
    const prResult = await this.agents.pr.execute(prCtx);

    if (prResult.prUrl) {
      onProgress?.(`PR opened: ${prResult.prUrl}`);
      return { prUrl: prResult.prUrl };
    }

    onProgress?.(`PR failed: ${prResult.error ?? "unknown error"}`);
    return {};
  }
}
