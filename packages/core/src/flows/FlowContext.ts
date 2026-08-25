import { logger } from "../logging";
import type { WorkspaceHandle } from "../workspace/WorkspaceHandle";
import { FlowParams, FlowStateStore } from "./FlowStateStore";
import { ResultPathWalker } from "./resultPath";
import { TemplateResolver } from "./templateResolver";

type FlowContextParams = {
  /** Step results keyed by instruction id. */
  readonly results: ReadonlyMap<string, InstructionResult>;
  /** The top-level task description. */
  readonly prompt: string;
  /** Named workspaces created during routine execution. */
  readonly workspaces?: ReadonlyMap<string, WorkspaceHandle>;
  /** Routine parameters passed by the orchestrator LLM. */
  readonly params?: ReadonlyMap<string, string>;
  /** Accumulated feedback from prior loop iterations. */
  readonly feedback?: string;
  /** Current loop iteration (0-indexed). */
  readonly iteration?: number;
  /** Flow-global session that persists across routine calls. */
  readonly store?: FlowStateStore;
  /** Nesting depth for inline routine refs (guards against infinite recursion). */
  readonly depth?: number;
};

/**
 * Immutable value object carrying the state of an in-progress routine execution.
 *
 * Every mutation returns a new context — no shared mutable state between
 * instruction executors.
 */
export class FlowContext {
  /** Step results keyed by instruction id. */
  readonly results: ReadonlyMap<string, InstructionResult>;
  /** The top-level task description. */
  readonly prompt: string;
  /** Named workspaces created during routine execution. */
  readonly workspaces: ReadonlyMap<string, WorkspaceHandle>;
  /** Routine parameters passed by the orchestrator LLM. */
  readonly params: ReadonlyMap<string, string>;
  /** Accumulated feedback from prior loop iterations. */
  readonly feedback?: string;
  /** Current loop iteration (0-indexed). */
  readonly iteration: number;
  /** Flow-global session that persists across routine calls. */
  readonly store: FlowStateStore;
  /** Nesting depth for inline routine refs (guards against infinite recursion). */
  readonly depth: number;

  constructor(params: FlowContextParams) {
    this.results = params.results;
    this.prompt = params.prompt;
    this.workspaces = params.workspaces ?? new Map();
    this.params = params.params ?? new Map();
    this.feedback = params.feedback;
    this.iteration = params.iteration ?? 0;
    this.store = params.store ?? new FlowStateStore();
    this.depth = params.depth ?? 0;
  }

  // ── Mutations (return new FlowContext) ────────────────────

  withResult(id: string, result: InstructionResult): FlowContext {
    const next = new Map(this.results);
    next.set(id, result);
    return new FlowContext({
      results: next,
      prompt: this.prompt,
      workspaces: this.workspaces,
      params: this.params,
      feedback: this.feedback,
      iteration: this.iteration,
      store: this.store,
      depth: this.depth,
    });
  }

  withWorkspace(name: string, handle: WorkspaceHandle): FlowContext {
    const next = new Map(this.workspaces);
    next.set(name, handle);
    return new FlowContext({
      results: this.results,
      prompt: this.prompt,
      workspaces: next,
      params: this.params,
      feedback: this.feedback,
      iteration: this.iteration,
      store: this.store,
      depth: this.depth,
    });
  }

  withWorkspaceCleared(name: string): FlowContext {
    const next = new Map(this.workspaces);
    next.delete(name);
    return new FlowContext({
      results: this.results,
      prompt: this.prompt,
      workspaces: next,
      params: this.params,
      feedback: this.feedback,
      iteration: this.iteration,
      store: this.store,
      depth: this.depth,
    });
  }

  withParams(params: FlowParams): FlowContext {
    return new FlowContext({
      results: this.results,
      prompt: this.prompt,
      workspaces: this.workspaces,
      params: new Map(Object.entries(params)),
      feedback: this.feedback,
      iteration: this.iteration,
      store: this.store,
      depth: this.depth,
    });
  }

  withFeedback(feedback: string): FlowContext {
    return new FlowContext({
      results: this.results,
      prompt: this.prompt,
      workspaces: this.workspaces,
      params: this.params,
      feedback: feedback,
      iteration: this.iteration,
      store: this.store,
      depth: this.depth,
    });
  }

  withIteration(n: number): FlowContext {
    return new FlowContext({
      results: this.results,
      prompt: this.prompt,
      workspaces: this.workspaces,
      params: this.params,
      feedback: this.feedback,
      iteration: n,
      store: this.store,
      depth: this.depth,
    });
  }

  withResultsCleared(removeIds: Set<string>): FlowContext {
    const next = new Map(this.results);
    for (const id of removeIds) {
      next.delete(id);
    }
    return new FlowContext({
      results: next,
      prompt: this.prompt,
      workspaces: this.workspaces,
      params: this.params,
      feedback: this.feedback,
      iteration: this.iteration,
      store: this.store,
      depth: this.depth,
    });
  }

  withDepth(n: number): FlowContext {
    return new FlowContext({
      results: this.results,
      prompt: this.prompt,
      workspaces: this.workspaces,
      params: this.params,
      feedback: this.feedback,
      iteration: this.iteration,
      store: this.store,
      depth: n,
    });
  }

  withMergedParams(extra: Record<string, string>): FlowContext {
    const next = new Map(this.params);
    for (const [key, value] of Object.entries(extra)) {
      next.set(key, value);
    }
    return new FlowContext({
      results: this.results,
      prompt: this.prompt,
      workspaces: this.workspaces,
      params: next,
      feedback: this.feedback,
      iteration: this.iteration,
      store: this.store,
      depth: this.depth,
    });
  }

  // ── Workspace access ──────────────────────────────────────

  getWorkspacePath(name: string): string | undefined {
    return this.workspaces.get(name)?.path;
  }

  // ── Template resolution ───────────────────────────────────

  /**
   * Replace `{{PLACEHOLDER}}` tokens using the current context.
   *
   * Delegates to the shared `TemplateResolver.resolve` primitive; every token is
   * resolved via {@link lookupToken} and unknown tokens are kept verbatim.
   */
  resolve(template: string): string {
    return TemplateResolver.resolve(template, (token) => this.lookupToken(token));
  }

  private lookupToken(token: string): string | undefined {
    switch (token) {
      case "prompt":
        return this.prompt;
      case "feedback":
        return this.feedback ?? "(no prior findings)";
      default: {
        const paramValue = this.params.get(token);
        if (paramValue !== undefined) return paramValue;

        // session.<key> — flow-global state persisted across routine calls.
        if (token.startsWith("session.")) {
          const sessionKey = token.slice("session.".length);
          return this.store.get(sessionKey) ?? "";
        }

        // workspace.<name> - named workspaces created during routine execution.
        if (token.startsWith("workspace.")) {
          const name = token.slice("workspace.".length);
          return this.workspaces.get(name)?.path ?? "";
        }

        // results.<id>.<path> - step outputs, resolved via the shared walker.
        if (token.startsWith("results.")) {
          return this.resolveResultsPath(token);
        }

        logger.debug("Unresolved placeholder in flow template", { placeholder: token });
        return undefined;
      }
    }
  }

  private resolveResultsPath(token: string): string | undefined {
    const segments = token.split(".");
    if (segments.length < 3) {
      // A bare `results.<id>` is not resolvable - it stays a token.
      logger.debug("Unresolved placeholder in flow template", { placeholder: token });
      return undefined;
    }

    const id = segments[1];
    const path = segments.slice(2);
    const walked = ResultPathWalker.walk(this.results, id, path);
    if (!walked.ok) return "";

    const value = walked.value;
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  }
}

// ── Types ────────────────────────────────────────────────────

/**
 * Universal agent output shape.
 *
 * Every agent must produce `passed` and `summary`. All other fields
 * are agent-defined and passed through opaquely in `details` — the
 * codebase never inspects agent-specific internals.
 */
export interface AgentOutput {
  passed: boolean;
  summary: string;
  details?: Record<string, unknown>;
}

export interface InstructionResult {
  raw: string;
  parsed?: AgentOutput;
  /** Set by executors that produce a "skipped" outcome (e.g. a loop skipped by its while-guard). Drives the routine-level "skipped" status structurally. */
  skipped?: boolean;
  /**
   * Namespaced step outputs produced by a routine-ref instruction
   * (inlined step id → raw output). Lets loop feedback surface the
   * inlined agents' actual findings instead of the routine-ref envelope.
   */
  results?: Record<string, string>;
}
