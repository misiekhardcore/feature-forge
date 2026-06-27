import { logger } from "../logging";

export class FlowContext {
  constructor(
    readonly results: ReadonlyMap<string, InstructionResult>,
    readonly task: string,
    readonly plan: string,
    readonly workspace?: string,
    readonly feedback?: string,
    readonly workspaceId?: string,
    readonly iteration: number = 0,
  ) {}

  withResult(id: string, result: InstructionResult): FlowContext {
    const next = new Map(this.results);
    next.set(id, result);
    return new FlowContext(
      next,
      this.task,
      this.plan,
      this.workspace,
      this.feedback,
      this.workspaceId,
      this.iteration,
    );
  }

  withWorkspace(path: string, workspaceId: string): FlowContext {
    return new FlowContext(
      this.results,
      this.task,
      this.plan,
      path,
      this.feedback,
      workspaceId,
      this.iteration,
    );
  }

  withFeedback(feedback: string): FlowContext {
    return new FlowContext(
      this.results,
      this.task,
      this.plan,
      this.workspace,
      feedback,
      this.workspaceId,
      this.iteration,
    );
  }

  withIteration(n: number): FlowContext {
    return new FlowContext(
      this.results,
      this.task,
      this.plan,
      this.workspace,
      this.feedback,
      this.workspaceId,
      n,
    );
  }

  withResultsCleared(removeIds: Set<string>): FlowContext {
    const next = new Map(this.results);
    for (const id of removeIds) next.delete(id);
    return new FlowContext(
      next,
      this.task,
      this.plan,
      this.workspace,
      this.feedback,
      this.workspaceId,
      this.iteration,
    );
  }

  resolve(template: string): string {
    return template.replaceAll(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
      return this.resolvePlaceholder(key.trim());
    });
  }

  private resolvePlaceholder(key: string): string {
    switch (key) {
      case "task":
        return this.task;
      case "plan":
        return this.plan;
      case "feedback":
        return this.feedback ?? "(no prior findings)";
      case "workspace":
        return this.workspace ?? "";
      default: {
        const resolved = this.resolveNested(key, this);
        if (resolved.startsWith("{{") && resolved.endsWith("}}")) {
          logger.debug("Unresolved placeholder in flow template", { placeholder: key });
        }
        return resolved;
      }
    }
  }

  private resolveNested(key: string, ctx: FlowContext): string {
    const segments = key.split(".");
    if (segments[0] !== "results" || segments.length < 3) return "{{" + key + "}}";
    const instructionId = segments[1];
    const result = ctx.results.get(instructionId);
    if (!result) return "";
    let current: unknown = result;
    for (let i = 2; i < segments.length; i++) {
      if (current === null || current === undefined) return "";
      current = (current as Record<string, unknown>)[segments[i]];
    }
    return String(current ?? "");
  }
}

export interface ReviewFindings {
  kind: "review";
  passed: boolean;
  findings: { critical: string[]; warnings: string[]; info: string[] };
}

export interface BuildOutcome {
  kind: "build";
  passed: boolean;
  summary: string;
}

export type ParsedResult = ReviewFindings | BuildOutcome;

export interface InstructionResult {
  raw: string;
  parsed?: ParsedResult;
}
