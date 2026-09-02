import type {
  AgentToolResult,
  Theme,
  ThemeColor,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Box, Text, TruncatedText } from "@earendil-works/pi-tui";
import type { Static, TSchema } from "typebox";

/** Background colour tokens available to tool renderers (pi's `Theme.bg` parameter type). */
export type ToolBgColor = Parameters<Theme["bg"]>[0];

/** Per-tool-row render state kept across call/result renders for one tool row. */
export interface ToolShellState {
  /** Shell {@link Box} created by {@link ToolRenderer.shell}; reused across renders. */
  _box?: Box;
}

/**
 * The subset of pi's render context that custom tool renderers rely on.
 *
 * Tool renderers only ever touch these fields, so the local contract stays
 * stable when pi adds more context to its own `ToolRenderContext`.
 */
export interface ToolRenderContext {
  /** Shared renderer state for this tool row (shell box reuse). */
  state: ToolShellState;
  /** Whether the result view is expanded. */
  expanded: boolean;
  /** Whether the current result is an error. */
  isError: boolean;
}

/** Builder API passed to {@link ToolRenderer.shell}. */
export interface ToolShellBuilder {
  /** Add a single line that auto-truncates to viewport width when collapsed. */
  line: (text: string) => void;
  /** Add expandable multi-line content. Collapsed - single TruncatedText; expanded - one Text per line. */
  expandable: (text: string | undefined, style?: ThemeColor) => void;
}

/**
 * Contract each TUI-rendered CLI tool implements.
 *
 * `renderShell: "self"` opts the tool out of pi's default shell, so the
 * `renderCall`/`renderResult` pair fully controls the row. Omitting a member
 * or drifting from these signatures is a compile error against this local
 * contract. Note: the registry types tools as the base core `Tool`, so
 * conformance is enforced against this interface (a structural subset of
 * pi's `ToolDefinition`) rather than pi's own exported type - pi-side
 * renderer API drift is caught at runtime by pi's renderer fallback.
 */
export interface RenderableTool<TParams extends TSchema = TSchema, TDetails = unknown> {
  /** This tool renders its own shell box. */
  renderShell: "self";
  /** Render the tool-call row for the given validated arguments. */
  renderCall: (args: Static<TParams>, theme: Theme, context: ToolRenderContext) => Component;
  /** Render the tool-result row for the given result. */
  renderResult: (
    result: AgentToolResult<TDetails>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: ToolRenderContext,
  ) => Component;
}

/**
 * Extract `details.error` when the result carries non-empty string error details.
 *
 * Out-of-shape values (absent, empty, or non-string `error`) read as
 * success - every current producer (`IpcTool` error paths) emits non-empty
 * string errors, so this narrowing only fails loudly if a future producer
 * returns coded errors (`{ error: 500 }`) and must be typed as a string.
 */
function detailsError(result: AgentToolResult<unknown>): string | undefined {
  const details = result.details;
  if (
    details &&
    typeof details === "object" &&
    "error" in details &&
    typeof details.error === "string" &&
    details.error.length > 0
  ) {
    return details.error;
  }
  return undefined;
}

/** Extract the text content of a result, text parts joined with newlines. */
function contentMessage(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/**
 * General-purpose toolkit for tool TUI display.
 *
 * {@link ToolRenderer.shell} builds the tool-row shell box,
 * {@link ToolRenderer.simpleResult} renders the generic IPC checkmark/error
 * row and {@link ToolRenderer.messageResult} renders a confirmation-message
 * row.
 */
export class ToolRenderer {
  /** Static utility class - not instantiable. */
  private constructor() {}

  /** Bold text wrapped in the given theme colour - used for tool headers. */
  static header(theme: Theme, color: ThemeColor, text: string): string {
    return theme.fg(color, theme.bold(text));
  }

  /**
   * Construct (or reuse from `context.state._box`) a render Box with
   * auto-truncation and expand/collapse built in.
   *
   * This is the **only** shell entry point for tool rows - every
   * `renderCall` must pass through here, while result rows are standalone
   * `Text` components returned by `simpleResult`/`messageResult`. The
   * builder's {@link ToolShellBuilder.line} and
   * {@link ToolShellBuilder.expandable} methods automatically wrap content
   * in {@link TruncatedText} when the context is collapsed, so individual
   * renderers never need to worry about terminal width.
   */
  static shell(
    context: ToolRenderContext,
    theme: Theme,
    bgColor: ToolBgColor,
    fn: (b: ToolShellBuilder) => void,
  ): Box {
    const state = context.state;
    let box = state._box;
    if (!box) {
      box = new Box(0, 1);
      state._box = box;
    }
    box.setBgFn((text: string) => theme.bg(bgColor, text));
    box.clear();

    const builder: ToolShellBuilder = {
      line: (text: string) => {
        box.addChild(context.expanded ? new Text(text, 1, 0) : new TruncatedText(text, 1, 0));
      },
      expandable: (text: string | undefined, style?: ThemeColor) => {
        if (!text) return;
        if (context.expanded) {
          for (const l of text.split("\n")) {
            box.addChild(new Text(style ? theme.fg(style, l) : l, 1, 0));
          }
        } else {
          const styled = style ? theme.fg(style, text) : text;
          box.addChild(new TruncatedText(styled, 1, 0));
        }
      },
    };

    fn(builder);
    return box;
  }

  // Arrow-property statics (not methods) are deliberate: tools alias them,
  // e.g. `renderResult = ToolRenderer.simpleResult`, which would trip
  // @typescript-eslint/unbound-method if these were prototype methods.

  /**
   * Render a generic tool result: an error marker or a muted checkmark.
   *
   * For IPC tools (spawn/send/get/destroy/list) whose result payload is
   * opaque; error rows read `details.error` when present. Pi-level errors
   * that carry no error details (aborts, failed calls) surface the result
   * content via `context.isError`.
   */
  static simpleResult = (
    result: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: ToolRenderContext,
  ): Text => {
    if (options.isPartial) return new Text("", 1, 0);
    const error = detailsError(result);
    if (error !== undefined) {
      return new Text(theme.fg("error", `✗ ${error}`), 1, 0);
    }
    const message = contentMessage(result);
    if (context.isError) {
      return new Text(theme.fg("error", message ? `✗ ${message}` : "✗ failed"), 1, 0);
    }
    return new Text(theme.fg("muted", "✓ done"), 1, 0);
  };

  /**
   * Render a confirmation-message row for set-style tools.
   *
   * The result's text content is shown in the success colour, or an error
   * marker when the context flags an error. Falls back to a muted `✓ done`
   * when the result carries no message.
   */
  static messageResult = (
    result: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: ToolRenderContext,
  ): Text => {
    if (options.isPartial) return new Text("", 1, 0);
    const message = contentMessage(result);
    if (context.isError) {
      return new Text(theme.fg("error", message ? `✗ ${message}` : "✗ failed"), 1, 0);
    }
    return new Text(message ? theme.fg("success", message) : theme.fg("muted", "✓ done"), 1, 0);
  };
}
