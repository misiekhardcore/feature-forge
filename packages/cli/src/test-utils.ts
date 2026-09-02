import type { Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import type { ToolRenderContext } from "./tui/views/ToolRenderer";

export * from "@feature-forge/core/test-utils";

/**
 * Stub {@link Theme} emitting readable marker tags instead of ANSI codes so
 * render tests can assert on the wrapped structure (`[muted]`, `<b>`, ...).
 */
export function makeTheme(): Theme {
  return {
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
    bg: (color: string, text: string) => `[bg:${color}]${text}[/bg]`,
    bold: (text: string) => `<b>${text}</b>`,
  } as unknown as Theme;
}

/** Minimal tool-row render context for calling tool renderers in tests. */
export function makeRenderContext(overrides: Partial<ToolRenderContext> = {}): ToolRenderContext {
  return { state: {}, expanded: false, isError: false, ...overrides };
}

/** Default render options passed to renderResult in tests. */
export function makeRenderOptions(
  overrides: Partial<ToolRenderResultOptions> = {},
): ToolRenderResultOptions {
  return { expanded: false, isPartial: false, ...overrides };
}

/** Render a component to lines at the given width. */
export function renderLines(component: Component, width = 80): string[] {
  return component.render(width);
}
