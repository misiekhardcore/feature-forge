import * as fs from "node:fs/promises";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FlowDefinition } from "./FlowInstruction";
import { FlowLoader } from "./FlowLoader";

// ── Helpers ──────────────────────────────────────────────────

function makeValidFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    name: "test",
    command: "/test",
    orchestrator: { systemPrompt: "You are the test orchestrator." },
    routines: {
      main: {
        params: [{ name: "task" }],
        steps: [
          { type: "workspace", id: "ws", provider: "git-worktree" },
          {
            type: "loop",
            id: "main_loop",
            maxIterations: 3,
            steps: [
              { type: "agent", id: "builder", systemPrompt: "build", prompt: "do {{prompt}}" },
            ],
          },
          { type: "cleanup", id: "cleanup" },
        ],
      },
    },
    ...overrides,
  };
}

// ── Structural validation ────────────────────────────────────

describe("validateStructure", () => {
  it("accepts a valid flow definition", () => {
    expect(() => FlowLoader.validateStructure(makeValidFlow())).not.toThrow();
  });

  it("throws for missing name", () => {
    const { name: _, ...rest } = makeValidFlow();
    expect(() => FlowLoader.validateStructure(rest)).toThrow("Invalid flow definition");
  });

  it("throws for empty name", () => {
    expect(() => FlowLoader.validateStructure(makeValidFlow({ name: "" }))).toThrow();
  });

  it("throws for missing orchestrator", () => {
    const { orchestrator: _, ...rest } = makeValidFlow();
    expect(() => FlowLoader.validateStructure(rest)).toThrow();
  });

  it("throws for missing routines", () => {
    const { routines: _, ...rest } = makeValidFlow();
    expect(() => FlowLoader.validateStructure(rest)).toThrow();
  });

  it("throws for unknown instruction type", () => {
    expect(() =>
      FlowLoader.validateStructure(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "unknown_type",
                  id: "x",
                } as unknown as FlowDefinition["routines"]["_"]["steps"][number],
              ],
            },
          },
        }),
      ),
    ).toThrow();
  });

  it("throws for agent missing spec", () => {
    expect(() =>
      FlowLoader.validateStructure(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "agent",
                  id: "a",
                  prompt: "do it",
                  systemPrompt: "",
                },
              ],
            },
          },
        }),
      ),
    ).toThrow();
  });

  it("throws for loop missing maxIterations", () => {
    expect(() =>
      FlowLoader.validateStructure(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "l",
                  steps: [],
                } as unknown as FlowDefinition["routines"]["_"]["steps"][number],
              ],
            },
          },
        }),
      ),
    ).toThrow();
  });

  it("produces human-readable error messages", () => {
    try {
      FlowLoader.validateStructure({
        name: "x",
        command: "/x",
        orchestrator: { systemPrompt: "t" },
        routines: {
          main: {
            params: [],
            steps: [{ type: "agent", id: "a" }],
          },
        },
      });
    } catch (e: unknown) {
      const msg = (e as Error).message;
      expect(msg).toContain("Invalid flow definition");
      expect(msg).toContain("systemPrompt");
    }
  });
});

// ── Semantic validation ──────────────────────────────────────

describe("validateSemantics", () => {
  it("returns no errors for a valid flow", () => {
    const errors = FlowLoader.validateSemantics(makeValidFlow());
    expect(errors).toEqual([]);
  });

  // ── Duplicate ids ──────────────────────────────────────

  describe("duplicate ids", () => {
    it("detects duplicate top-level ids within a routine", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "ws", provider: "git-worktree" },
                { type: "workspace", id: "ws", provider: "git-worktree" },
              ],
            },
          },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Duplicate instruction id");
      expect(errors[0]).toContain("ws");
    });

    it("detects duplicate ids across nesting levels", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "ws", provider: "git-worktree" },
                {
                  type: "loop",
                  id: "loop1",
                  maxIterations: 3,
                  steps: [{ type: "agent", id: "ws", systemPrompt: "build", prompt: "x" }],
                },
              ],
            },
          },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Duplicate");
      expect(errors[0]).toContain("ws");
    });

    it("includes path info in duplicate error", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "dup", provider: "git-worktree" },
                {
                  type: "loop",
                  id: "loop1",
                  maxIterations: 3,
                  steps: [{ type: "agent", id: "dup", systemPrompt: "build", prompt: "x" }],
                },
              ],
            },
          },
        }),
      );
      expect(errors[0]).toContain("loop1 → dup");
      expect(errors[0]).toContain("first seen");
    });
  });

  // ── continueWhile expressions ───────────────────────────

  describe("continueWhile", () => {
    it("accepts a valid expression", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "l",
                  maxIterations: 5,
                  continueWhile: "!results.review?.parsed?.passed",
                  steps: [],
                },
              ],
            },
          },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("accepts the implement expression", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "l",
                  maxIterations: 5,
                  continueWhile:
                    "!results.builder?.parsed?.passed || !results.review?.parsed?.passed || !results.verify?.parsed?.passed",
                  steps: [],
                },
              ],
            },
          },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("rejects a syntactically invalid expression", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "l",
                  maxIterations: 5,
                  continueWhile: "true + false",
                  steps: [],
                },
              ],
            },
          },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Invalid continueWhile expression");
    });

    it("includes the loop path in the error", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "bad_loop",
                  maxIterations: 3,
                  continueWhile: "@@@",
                  steps: [],
                },
              ],
            },
          },
        }),
      );
      expect(errors[0]).toContain("bad_loop");
    });

    it("accepts a loop without continueWhile", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "l",
                  maxIterations: 3,
                  steps: [],
                },
              ],
            },
          },
        }),
      );
      expect(errors).toEqual([]);
    });
  });

  // ── accumulateFrom ──────────────────────────────────────

  describe("accumulateFrom", () => {
    it("accepts valid direct-child references", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "l",
                  maxIterations: 3,
                  accumulateFrom: ["review", "verify"],
                  steps: [
                    {
                      type: "agent",
                      id: "review",
                      systemPrompt: "review",
                      prompt: "review",
                      parseJson: true,
                    },
                    {
                      type: "agent",
                      id: "verify",
                      systemPrompt: "verify",
                      prompt: "verify",
                      parseJson: true,
                    },
                  ],
                },
              ],
            },
          },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("rejects reference to non-existent id", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "l",
                  maxIterations: 3,
                  accumulateFrom: ["nonexistent"],
                  steps: [{ type: "agent", id: "builder", systemPrompt: "build", prompt: "x" }],
                },
              ],
            },
          },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("accumulateFrom references unknown");
      expect(errors[0]).toContain("nonexistent");
    });

    it("accepts accumulateFrom referencing id inside nested parallel", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "l",
                  maxIterations: 3,
                  accumulateFrom: ["nested_agent"],
                  steps: [
                    {
                      type: "parallel",
                      id: "inspect",
                      steps: [
                        {
                          type: "agent",
                          id: "nested_agent",
                          systemPrompt: "review",
                          prompt: "r",
                          parseJson: true,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("rejects accumulateFrom targeting instruction without parseJson", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "l",
                  maxIterations: 3,
                  accumulateFrom: ["builder"],
                  steps: [
                    {
                      type: "agent",
                      id: "builder",
                      systemPrompt: "build",
                      prompt: "do {{prompt}}",
                    },
                  ],
                },
              ],
            },
          },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("accumulateFrom");
      expect(errors[0]).toContain("without parseJson: true");
    });

    it("accepts a loop without accumulateFrom", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "l",
                  maxIterations: 3,
                  steps: [],
                },
              ],
            },
          },
        }),
      );
      expect(errors).toEqual([]);
    });
  });

  // ── Multiple errors ─────────────────────────────────────

  it("reports multiple semantic errors", () => {
    const errors = FlowLoader.validateSemantics(
      makeValidFlow({
        routines: {
          main: {
            params: [],
            steps: [
              { type: "workspace", id: "dup", provider: "git-worktree" },
              { type: "workspace", id: "dup", provider: "git-worktree" },
              {
                type: "loop",
                id: "bad",
                maxIterations: 3,
                continueWhile: "@@@",
                accumulateFrom: ["missing"],
                steps: [],
              },
            ],
          },
        },
      }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  // ── knownSpecs ──────────────────────────────────────────

  describe("knownSpecs", () => {
    it("rejects unknown spec when knownSpecs is provided", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [{ type: "agent", id: "a1", systemPrompt: "unknown-spec", prompt: "do it" }],
            },
          },
        }),
        new Set(["build", "review", "verify"]),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Unknown spec "unknown-spec"');
      expect(errors[0]).toContain("a1");
    });

    it("accepts known spec when knownSpecs is provided", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [{ type: "agent", id: "a1", systemPrompt: "build", prompt: "do it" }],
            },
          },
        }),
        new Set(["build", "review", "verify"]),
      );
      expect(errors).toEqual([]);
    });

    it("skips spec check when knownSpecs is omitted", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [{ type: "agent", id: "a1", systemPrompt: "unknown-spec", prompt: "do it" }],
            },
          },
        }),
      );
      expect(errors).toEqual([]);
    });
  });

  // ── knownProviders ──────────────────────────────────────

  describe("knownProviders", () => {
    it("rejects unknown provider when knownProviders is provided", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [{ type: "workspace", id: "ws1", provider: "docker" as "git-worktree" }],
            },
          },
        }),
        undefined,
        new Set(["git-worktree", "current-dir"]),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Unknown provider "docker"');
    });

    it("accepts known provider when knownProviders is provided", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [{ type: "workspace", id: "ws1", provider: "git-worktree" }],
            },
          },
        }),
        undefined,
        new Set(["git-worktree", "current-dir"]),
      );
      expect(errors).toEqual([]);
    });

    it("skips provider check when knownProviders is omitted", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [{ type: "workspace", id: "ws1", provider: "docker" as "git-worktree" }],
            },
          },
        }),
      );
      expect(errors).toEqual([]);
    });
  });
});

// ── FlowLoader (integration) ─────────────────────────────────

describe("FlowLoader", () => {
  let tempDir: string;
  let loader: FlowLoader;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp("/tmp/flow-loader-test-");
    loader = new FlowLoader({ flowsDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("loads and validates a flow file", async () => {
    const flow: FlowDefinition = {
      name: "test",
      command: "/load-test",
      orchestrator: { systemPrompt: "t" },
      routines: {
        main: {
          params: [{ name: "task" }],
          steps: [
            { type: "workspace", id: "ws", provider: "git-worktree" },
            { type: "cleanup", id: "cleanup" },
          ],
        },
      },
    };
    await fs.writeFile(path.join(tempDir, "test.json"), JSON.stringify(flow));

    const loaded = await loader.load("test");
    expect(loaded.name).toBe("test");
    expect(loaded.routines["main"].steps).toHaveLength(2);
  });

  it("loads the real implement flow", async () => {
    const realLoader = new FlowLoader({
      flowsDir: path.join(__dirname, "..", "flows", "implement"),
    });
    const flow = await realLoader.load("flow");
    expect(flow.name).toBe("implement");
    expect(Object.keys(flow.routines).length).toBeGreaterThan(0);
  });

  it("throws for non-existent flow", async () => {
    await expect(loader.load("nonexistent")).rejects.toThrow("not found");
  });

  it("throws for invalid JSON", async () => {
    await fs.writeFile(path.join(tempDir, "bad.json"), "not json");
    await expect(loader.load("bad")).rejects.toThrow("contains invalid JSON");
  });

  it("throws for semantically invalid flow (duplicate ids)", async () => {
    const flow: FlowDefinition = {
      name: "dup",
      command: "/dup",
      orchestrator: { systemPrompt: "t" },
      routines: {
        main: {
          params: [],
          steps: [
            { type: "workspace", id: "dup", provider: "git-worktree" },
            { type: "workspace", id: "dup", provider: "git-worktree" },
          ],
        },
      },
    };
    await fs.writeFile(path.join(tempDir, "dup.json"), JSON.stringify(flow));

    await expect(loader.load("dup")).rejects.toThrow("Duplicate instruction id");
  });

  it("loadAll returns all .json files", async () => {
    await fs.writeFile(
      path.join(tempDir, "a.json"),
      JSON.stringify(
        makeValidFlow({
          name: "a",
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "ws", provider: "git-worktree" },
                // { type: "cleanup", id: "c", of: "some-value" },
              ],
            },
          },
        }),
      ),
    );
    await fs.writeFile(
      path.join(tempDir, "b.json"),
      JSON.stringify(
        makeValidFlow({
          name: "b",
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "ws", provider: "git-worktree" },
                { type: "cleanup", id: "c", of: "some-value" },
              ],
            },
          },
        }),
      ),
    );

    const { flows, failures } = await loader.loadAll();
    expect(flows.size).toBe(2);
    expect(flows.has("a")).toBe(true);
    expect(flows.has("b")).toBe(true);
    expect(failures.size).toBe(0);
  });

  it("loadAll ignores non-JSON files", async () => {
    await fs.writeFile(
      path.join(tempDir, "a.json"),
      JSON.stringify(
        makeValidFlow({
          name: "a",
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "ws", provider: "git-worktree" },
                { type: "cleanup", id: "c" },
              ],
            },
          },
        }),
      ),
    );
    await fs.writeFile(path.join(tempDir, "readme.md"), "# docs");

    const { flows } = await loader.loadAll();
    expect(flows.size).toBe(1);
  });

  it("loadAll collects failures instead of aborting", async () => {
    // Valid flow
    await fs.writeFile(
      path.join(tempDir, "good.json"),
      JSON.stringify(
        makeValidFlow({
          name: "good",
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "ws", provider: "git-worktree" },
                { type: "cleanup", id: "c" },
              ],
            },
          },
        }),
      ),
    );
    // Invalid flow — duplicate ids
    await fs.writeFile(
      path.join(tempDir, "bad.json"),
      JSON.stringify({
        name: "bad",
        command: "/bad",
        orchestrator: { systemPrompt: "t" },
        routines: {
          main: {
            params: [],
            steps: [
              { type: "workspace", id: "dup", provider: "git-worktree" },
              { type: "workspace", id: "dup", provider: "git-worktree" },
            ],
          },
        },
      }),
    );

    const { flows, failures } = await loader.loadAll();
    expect(flows.size).toBe(1);
    expect(flows.has("good")).toBe(true);
    expect(failures.size).toBe(1);
    expect(failures.has("bad")).toBe(true);
    expect(failures.get("bad")!.message).toContain("Duplicate instruction id");
  });

  it("loadAll returns empty when no json files present", async () => {
    const { flows, failures } = await loader.loadAll();
    expect(flows.size).toBe(0);
    expect(failures.size).toBe(0);
  });
});
