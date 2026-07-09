import { logger } from "../logging";
import type { WorkspaceHandle } from "../workspace/WorkspaceHandle";
import { FlowParams, FlowStateStore } from "./FlowStateStore";

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
  /** Async provider that resolves feedback at runtime (used by child routines for event routing). */
  readonly feedbackProvider?: () => Promise<string>;
  /** Current nested routine call depth (0 = top-level routine). */
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
  /** Async provider that resolves feedback at runtime (used by child routines for event routing). */
  readonly feedbackProvider?: () => Promise<string>;
  /** Current nested routine call depth (0 = top-level routine). */
  readonly depth: number;

  constructor(params: FlowContextParams) {
    this.results = params.results;
    this.prompt = params.prompt;
    this.workspaces = params.workspaces ?? new Map();
    this.params = params.params ?? new Map();
    this.feedback = params.feedback;
    this.feedbackProvider = params.feedbackProvider;
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
      feedbackProvider: this.feedbackProvider,
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
      feedbackProvider: this.feedbackProvider,
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
      feedbackProvider: this.feedbackProvider,
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
      feedbackProvider: this.feedbackProvider,
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
      feedbackProvider: this.feedbackProvider,
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
      feedbackProvider: this.feedbackProvider,
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
      feedbackProvider: this.feedbackProvider,
      iteration: this.iteration,
      store: this.store,
      depth: this.depth,
    });
  }

  /**
   * Return a new context with the depth set to the given value.
   * Used when entering a child routine call.
   */
  withDepth(n: number): FlowContext {
    return new FlowContext({
      results: this.results,
      prompt: this.prompt,
      workspaces: this.workspaces,
      params: this.params,
      feedback: this.feedback,
      feedbackProvider: this.feedbackProvider,
      iteration: this.iteration,
      store: this.store,
      depth: n,
    });
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
        if (this.feedback) return this.feedback;
        if (this.feedbackProvider) throw new FeedbackPendingError();
        return "(no prior findings)";
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
}

/**
 * Thrown when a {{feedback}} placeholder is resolved in a context
 * that has a feedbackProvider but no cached feedback value yet.
 *
 * The calling executor should catch this, await the provider, and
 * retry resolution with the returned feedback value.
 */
export class FeedbackPendingError extends Error {
  constructor() {
    super("Feedback is pending — await the provider and retry");
    this.name = "FeedbackPendingError";
  }
}
