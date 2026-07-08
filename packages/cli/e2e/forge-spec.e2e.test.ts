/**
 * End-to-end tests for FORGE_SPEC runtime initialization integrity.
 *
 * Verifies that when a pi subprocess is spawned with FORGE_SPEC set to
 * various specification JSON payloads, the extension loads without crashing,
 * the process stays alive, and the socket roundtrip functions correctly.
 *
 * Tool restriction enforcement logic is exhaustively covered by unit tests
 * (tool-restrictions.test.ts, spec-resolution.test.ts). These e2e tests
 * focus on runtime initialization integrity: does the extension load, does
 * the child stay alive, does the socket work?
 *
 * Prerequisites: `pi` CLI must be on PATH.
 */

import { describe, it } from "vitest";

import { createMockSpec, spawnAndVerify } from "./helpers";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const ALL_SEVEN_TOOLS = ["bash", "write", "grep", "read", "edit", "find", "ls"] as const;

describe("FORGE_SPEC E2E", () => {
  describe("smoke: all 7 restrictable tools", () => {
    for (const toolName of ALL_SEVEN_TOOLS) {
      it(`loads without crash when restricting "${toolName}" tool`, async () => {
        const spec = createMockSpec({
          id: `spec-${toolName}`,
          role: `spec-${toolName}`,
          systemPrompt: `Restricted ${toolName} agent`,
          tools: [...ALL_SEVEN_TOOLS],
          toolRestrictions: { [toolName]: ["allowed-*"] },
        });
        await spawnAndVerify(spec.toJSON(), `smoke-${toolName}`);
      }, 20_000);
    }
  });

  describe("excludedTools", () => {
    it("loads without crash when excludedTools filters explicit allowlist", async () => {
      await spawnAndVerify(
        createMockSpec({
          id: "spec-excluded-allowlist",
          role: "spec-excluded-allowlist",
          systemPrompt: "Agent with excluded tools from allowlist",
          tools: ["read", "grep", "ls", "bash", "write"],
          excludedTools: ["bash", "write"],
        }).toJSON(),
        "excluded-allowlist",
      );
    }, 20_000);

    it("loads without crash when excludedTools filters default tools", async () => {
      await spawnAndVerify(
        createMockSpec({
          id: "spec-excluded-default",
          role: "spec-excluded-default",
          systemPrompt: "Agent with excluded tools from defaults",
          tools: [],
          excludedTools: ["bash", "write"],
        }).toJSON(),
        "excluded-default",
      );
    }, 20_000);

    it("loads without crash when all tools are excluded from allowlist", async () => {
      await spawnAndVerify(
        createMockSpec({
          id: "spec-all-excluded",
          role: "spec-all-excluded",
          systemPrompt: "Agent with all tools excluded",
          tools: ["bash", "write"],
          excludedTools: ["bash", "write"],
        }).toJSON(),
        "all-excluded",
      );
    }, 20_000);
  });

  describe("thinkingLevel", () => {
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

    for (const level of levels) {
      it(`loads without crash when thinkingLevel is "${level}"`, async () => {
        await spawnAndVerify(
          createMockSpec({
            id: `spec-thinking-${level}`,
            role: `spec-thinking-${level}`,
            systemPrompt: `Thinking level ${level}`,
            tools: ["read", "grep"],
            thinkingLevel: level,
          }).toJSON(),
          `thinking-${level}`,
        );
      }, 20_000);
    }
  });

  describe("combined fields", () => {
    it("loads without crash when combining all FORGE_SPEC fields", async () => {
      await spawnAndVerify(
        createMockSpec({
          id: "spec-combined",
          role: "spec-combined",
          systemPrompt: "Combined spec with tools, exclusions, restrictions, and thinking",
          tools: ["read", "grep", "ls", "bash", "write", "edit", "find"],
          excludedTools: ["write"],
          thinkingLevel: "high",
          toolRestrictions: {
            bash: ["git *", "npm *"],
            edit: ["src/*"],
            write: ["src/*"],
          },
        }).toJSON(),
        "combined",
      );
    }, 20_000);

    it("loads without crash with tools, restrictions, and thinking but no exclusions", async () => {
      await spawnAndVerify(
        createMockSpec({
          id: "spec-tools-restrictions-thinking",
          role: "spec-tools-restrictions-thinking",
          systemPrompt: "Tools with restrictions and thinking, no exclusions",
          tools: ["read", "grep", "ls", "bash"],
          thinkingLevel: "medium",
          toolRestrictions: { bash: ["safe:*"] },
        }).toJSON(),
        "tools-restrictions-thinking",
      );
    }, 20_000);

    it("loads without crash with restrictions on multiple tools and exclusions", async () => {
      await spawnAndVerify(
        createMockSpec({
          id: "spec-multi-restrictions",
          role: "spec-multi-restrictions",
          systemPrompt: "Multiple tool restrictions with exclusions",
          tools: ["read", "grep", "ls", "bash", "edit", "find"],
          excludedTools: ["edit"],
          toolRestrictions: {
            bash: ["safe:*"],
            find: ["src/*"],
            grep: ["src/*"],
          },
        }).toJSON(),
        "multi-restrictions",
      );
    }, 20_000);
  });

  describe("baseline", () => {
    it("loads without FORGE_SPEC set at all", async () => {
      await spawnAndVerify(null, "baseline-no-spec");
    }, 20_000);

    it("loads with minimal FORGE_SPEC (only tools)", async () => {
      await spawnAndVerify(
        createMockSpec({
          id: "spec-minimal",
          role: "spec-minimal",
          systemPrompt: "Minimal spec",
          tools: ["read", "bash"],
        }).toJSON(),
        "baseline-minimal",
      );
    }, 20_000);

    it("loads with empty tools array", async () => {
      await spawnAndVerify(
        createMockSpec({
          id: "spec-empty-tools",
          role: "spec-empty-tools",
          systemPrompt: "Empty tools spec",
          tools: [],
        }).toJSON(),
        "baseline-empty-tools",
      );
    }, 20_000);

    it("loads with empty toolRestrictions object", async () => {
      await spawnAndVerify(
        createMockSpec({
          id: "spec-empty-restrictions",
          role: "spec-empty-restrictions",
          systemPrompt: "Empty restrictions spec",
          tools: ["read", "bash"],
          toolRestrictions: {},
        }).toJSON(),
        "baseline-empty-restrictions",
      );
    }, 20_000);

    it("loads with system prompt only (no tools)", async () => {
      await spawnAndVerify(
        createMockSpec({
          id: "spec-system-prompt-only",
          role: "spec-system-prompt-only",
          systemPrompt: "Only a system prompt, no tools listed",
        }).toJSON(),
        "baseline-system-prompt-only",
      );
    }, 20_000);
  });
});
