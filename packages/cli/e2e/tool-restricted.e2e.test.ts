/**
 * End-to-end tests for tool pattern restrictions in child subprocess agents.
 *
 * Verifies that when a pi subprocess is spawned with FORGE_SPEC set to
 * a full spec JSON containing tool restrictions, the child's tool-restrictions
 * interceptor activates without crashes and the socket roundtrip
 * functions correctly.
 *
 * Each test verifies runtime initialization integrity for a different
 * restricted tool (bash, write, grep, read, edit, find, ls).
 *
 * Prerequisites: `pi` CLI must be on PATH.
 */

import { describe, it } from "vitest";

import { createMockSpec, spawnAndVerify } from "./helpers";

const ALL_RESTRICTABLE_TOOLS = ["bash", "write", "grep", "read", "edit", "find", "ls"] as const;

function toolsToRestrictions(tools: readonly string[]): Record<string, readonly string[]> {
  const restrictions: Record<string, readonly string[]> = {};
  for (const tool of tools) restrictions[tool] = [];
  return restrictions;
}

describe("tool-restricted E2E", () => {
  for (const toolName of ALL_RESTRICTABLE_TOOLS) {
    it(`loads without crash when restricting "${toolName}" tool`, async () => {
      await spawnAndVerify(
        createMockSpec({
          id: `tool-restricted-${toolName}`,
          role: `tool-restricted-${toolName}`,
          systemPrompt: `Test agent with restricted ${toolName}`,
          toolRestrictions: {
            ...toolsToRestrictions(ALL_RESTRICTABLE_TOOLS),
            [toolName]: ["allowed-*"],
          },
        }).toJSON(),
        `tool-e2e-${toolName}`,
      );
    }, 20_000);
  }

  it("loads the extension with all tools restricted simultaneously", async () => {
    await spawnAndVerify(
      createMockSpec({
        id: "tool-restricted-all",
        role: "tool-restricted-all",
        systemPrompt: "Agent with all tools restricted",
        toolRestrictions: {
          ...toolsToRestrictions(ALL_RESTRICTABLE_TOOLS),
          bash: ["git *", "npm *"],
          write: ["src/**"],
          grep: ["src/**", "packages/**"],
          read: ["src/**", "packages/**", "*.md", "*.json"],
          edit: ["src/**"],
          find: ["src/**"],
          ls: ["src/**", "packages/**", "."],
        },
      }).toJSON(),
      "tool-e2e-all",
    );
  }, 20_000);

  it("loads the extension with tool restrictions and exclusions combined", async () => {
    await spawnAndVerify(
      createMockSpec({
        id: "tool-restricted-excluded",
        role: "tool-restricted-excluded",
        systemPrompt: "Agent with restrictions and exclusions",
        toolRestrictions: {
          ...toolsToRestrictions(["read", "grep", "ls", "bash", "write", "edit"]),
          bash: ["git *"],
          write: ["src/**"],
        },
      }).toJSON(),
      "tool-e2e-excluded",
    );
  }, 20_000);

  it("loads the extension without FORGE_SPEC and connects normally", async () => {
    await spawnAndVerify(null, "tool-baseline-test");
  }, 15_000);
});
