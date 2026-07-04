import { logger } from "../logging";
import type { WorkspaceHandle } from "../workspace/WorkspaceHandle";
import { FlowParams, FlowStateStore } from "./FlowStateStore";

/**
 * Immutable value object carrying the state of an in-progress routine execution.
 *
 * Every mutation returns a new context — no shared mutable state between
 * instruction executors.
 */
export class FlowContext {
  constructor(
    /** Step results keyed by instruction id. */
    readonly results: ReadonlyMap<string, InstructionResult>,
    /** The top-level task description. */
    readonly prompt: string,
    /** Named workspaces created during routine execution. */
    readonly workspaces: ReadonlyMap<string, WorkspaceHandle> = new Map(),
    /** Routine parameters passed by the orchestrator LLM. */
    readonly params: ReadonlyMap<string, string> = new Map(),
    /** Accumulated feedback from prior loop iterations. */
    readonly feedback?: string,
    /** Current loop iteration (0-indexed). */
    readonly iteration: number = 0,
    /** Flow-global session that persists across routine calls. */
    readonly store: FlowStateStore = new FlowStateStore(),
  ) {}

  // ── Mutations (return new FlowContext) ────────────────────

  withResult(id: string, result: InstructionResult): FlowContext {
    const next = new Map(this.results);
    next.set(id, result);
    return new FlowContext(
      next,
      this.prompt,
      this.workspaces,
      this.params,
      this.feedback,
      this.iteration,
      this.store,
    );
  }

  withWorkspace(name: string, handle: WorkspaceHandle): FlowContext {
    const next = new Map(this.workspaces);
    next.set(name, handle);
    return new FlowContext(
      this.results,
      this.prompt,
      next,
      this.params,
      this.feedback,
      this.iteration,
      this.store,
    );
  }

  withWorkspaceCleared(name: string): FlowContext {
    const next = new Map(this.workspaces);
    next.delete(name);
    return new FlowContext(
      this.results,
      this.prompt,
      next,
      this.params,
      this.feedback,
      this.iteration,
      this.store,
    );
  }

  withParams(params: FlowParams): FlowContext {
    return new FlowContext(
      this.results,
      this.prompt,
      this.workspaces,
      new Map(Object.entries(params)),
      this.feedback,
      this.iteration,
    );
  }

  withFeedback(feedback: string): FlowContext {
    return new FlowContext(
      this.results,
      this.prompt,
      this.workspaces,
      this.params,
      feedback,
      this.iteration,
      this.store,
    );
  }

  withIteration(n: number): FlowContext {
    return new FlowContext(
      this.results,
      this.prompt,
      this.workspaces,
      this.params,
      this.feedback,
      n,
    );
  }

  withResultsCleared(removeIds: Set<string>): FlowContext {
    const next = new Map(this.results);
    for (const id of removeIds) {
      next.delete(id);
    }
    return new FlowContext(
      next,
      this.prompt,
      this.workspaces,
      this.params,
      this.feedback,
      this.iteration,
    );
  }

  // ── Workspace access ──────────────────────────────────────

  getWorkspacePath(name: string): string | undefined {
    return this.workspaces.get(name)?.path;
  }

  // ── Template resolution ───────────────────────────────────

  /**
   * Replace `{{PLACEHOLDER}}` tokens using the current context.
   */
  resolve(template: string): string {
    return template.replaceAll(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
      return this.resolvePlaceholder(key.trim());
    });
  }

  private resolvePlaceholder(key: string): string {
    switch (key) {
      case "prompt":
        return this.prompt;
      case "feedback":
        return this.feedback ?? "(no prior findings)";
      default: {
        const paramValue = this.params.get(key);
        if (paramValue !== undefined) return paramValue;

        // session.<key> — flow-global state persisted across routine calls.
        if (key.startsWith("session.")) {
          const sessionKey = key.slice("session.".length);
          return this.store.get(sessionKey) ?? "";
        }

        if (key.startsWith("workspace.")) {
          const name = key.slice("workspace.".length);
          const handle = this.workspaces.get(name);
          return handle?.path ?? "";
        }

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

    if (segments[0] !== "results" || segments.length < 3) {
      return `{{${key}}}`;
    }

    const instructionId = segments[1];
    const result = ctx.results.get(instructionId);
    if (!result) return "";

    let current: unknown = result;
    for (let i = 2; i < segments.length; i++) {
      if (current === null || current === undefined) return "";
      current = (current as Record<string, unknown>)[segments[i]];
    }

    if (current === null || current === undefined) return "";
    if (typeof current === "string") return current;
    if (typeof current === "number" || typeof current === "boolean") return String(current);
    return JSON.stringify(current);
  }
}

// ── Types ────────────────────────────────────────────────────

export interface ReviewFindings {
  kind: "review";
  passed: boolean;
  findings: {
    critical: string[];
    warnings: string[];
    info: string[];
  };
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
