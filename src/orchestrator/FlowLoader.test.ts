import * as fs from "node:fs/promises";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FlowDefinition } from "./FlowInstruction";
import { FlowLoader } from "./FlowLoader";

// ── Helpers ──────────────────────────────────────────────────

function makeSingleRoutineSteps() {
  return [
    { type: "workspace" as const, id: "ws" },
    {
      type: "loop" as const,
      id: "main_loop",
      maxIterations: 3,
      steps: [{ type: "agent" as const, id: "builder", spec: "build", task: "do {{task}}" }],
    },
    { type: "cleanup" as const, id: "cleanup" },
  ];
}

function makeValidFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    name: "test",
    command: "/test",
    orchestrator: { prompt: "orchestrator.md" },
    routines: {
      main: {
        params: [{ name: "task" }],
        steps: makeSingleRoutineSteps(),
      },
    },
    ...overrides,
  };
}

/** Write a flow package to a temp directory (flow.json + optional orchestrator.md). */
async function writeFlowPkg(
  baseDir: string,
  name: string,
  flow: FlowDefinition,
  orchestratorMd?: string,
): Promise<void> {
  const pkgDir = path.join(baseDir, name);
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, "flow.json"), JSON.stringify(flow));
  if (orchestratorMd !== undefined) {
    await fs.writeFile(path.join(pkgDir, "orchestrator.md"), orchestratorMd);
  }
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

  it("throws for missing routines", () => {
    const { routines: _, ...rest } = makeValidFlow();
    expect(() => FlowLoader.validateStructure(rest)).toThrow();
  });

  it("throws for unknown instruction type", () => {
    expect(() =>
      FlowLoader.validateStructure(
        makeValidFlow({
          routines: {
            r: {
              params: [],
              steps: [
                {
                  type: "unknown_type",
                  id: "x",
                } as unknown as FlowDefinition["routines"][string]["steps"][number],
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
            r: {
              params: [],
              steps: [
                {
                  type: "agent",
                  id: "a",
                  task: "do it",
                } as unknown as FlowDefinition["routines"][string]["steps"][number],
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
            r: {
              params: [],
              steps: [
                {
                  type: "loop",
                  id: "l",
                  steps: [],
                } as unknown as FlowDefinition["routines"][string]["steps"][number],
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
        orchestrator: { prompt: "o.md" },
        routines: {
          r: {
            params: [],
            steps: [{ type: "agent", id: "a" }],
          },
        },
      });
    } catch (e: unknown) {
      const msg = (e as Error).message;
      expect(msg).toContain("Invalid flow definition");
      expect(msg).toContain("spec");
    }
  });
});

// ── Semantic validation ──────────────────────────────────────

describe("validateSemantics", () => {
  it("returns no errors for a valid flow", () => {
    const errors = FlowLoader.validateSemantics(makeValidFlow());
    expect(errors).toEqual([]);
  });

  // ── activeTools ────────────────────────────────────────

  describe("activeTools", () => {
    it("accepts activeTools referencing existing routines", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          orchestrator: { prompt: "o.md", activeTools: ["main"] },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("rejects activeTools referencing unknown routines", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          orchestrator: { prompt: "o.md", activeTools: ["nonexistent"] },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("activeTools references unknown routine");
      expect(errors[0]).toContain("nonexistent");
    });

    it("reports all unknown activeTools", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          orchestrator: { prompt: "o.md", activeTools: ["missing1", "main", "missing2"] },
        }),
      );
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain("missing1");
      expect(errors[1]).toContain("missing2");
    });

    it("accepts flow without activeTools", () => {
      const errors = FlowLoader.validateSemantics(makeValidFlow());
      expect(errors).toEqual([]);
    });
  });

  // ── Duplicate ids ──────────────────────────────────────

  describe("duplicate ids", () => {
    it("detects duplicate ids within a single routine", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "dup" },
                { type: "workspace", id: "dup" },
              ],
            },
          },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Duplicate instruction id");
      expect(errors[0]).toContain("dup");
    });

    it("allows same id in different routines (per-routine scope)", () => {
      const errors = FlowLoader.validateSemantics({
        name: "test",
        command: "/test",
        orchestrator: { prompt: "o.md" },
        routines: {
          r1: {
            params: [],
            steps: [{ type: "workspace", id: "same_id" }],
          },
          r2: {
            params: [],
            steps: [{ type: "workspace", id: "same_id" }],
          },
        },
      });
      // No duplicate error - ids are scoped per routine
      expect(errors.filter((e) => e.includes("Duplicate")).length).toBe(0);
    });

    it("detects duplicate ids across nesting levels within a routine", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "dup" },
                {
                  type: "loop",
                  id: "loop1",
                  maxIterations: 3,
                  steps: [{ type: "agent", id: "dup", spec: "build", task: "x" }],
                },
              ],
            },
          },
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Duplicate");
      expect(errors[0]).toContain("dup");
    });

    it("includes path info in duplicate error", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "dup" },
                {
                  type: "loop",
                  id: "loop1",
                  maxIterations: 3,
                  steps: [{ type: "agent", id: "dup", spec: "build", task: "x" }],
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
      const flow = makeValidFlow({
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
      });
      const errors = FlowLoader.validateSemantics(flow);
      expect(errors).toEqual([]);
    });

    it("accepts the implement expression", () => {
      const flow = makeValidFlow({
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
      });
      const errors = FlowLoader.validateSemantics(flow);
      expect(errors).toEqual([]);
    });

    it("rejects a syntactically invalid expression", () => {
      const flow = makeValidFlow({
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
      });
      const errors = FlowLoader.validateSemantics(flow);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Invalid continueWhile expression");
    });

    it("accepts a loop without continueWhile", () => {
      const flow = makeValidFlow({
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
      });
      const errors = FlowLoader.validateSemantics(flow);
      expect(errors).toEqual([]);
    });
  });

  // ── accumulateFrom ──────────────────────────────────────

  describe("accumulateFrom", () => {
    it("accepts valid direct-child references", () => {
      const flow = makeValidFlow({
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
                    spec: "review",
                    task: "review",
                    parseJson: true,
                  },
                  {
                    type: "agent",
                    id: "verify",
                    spec: "verify",
                    task: "verify",
                    parseJson: true,
                  },
                ],
              },
            ],
          },
        },
      });
      const errors = FlowLoader.validateSemantics(flow);
      expect(errors).toEqual([]);
    });

    it("rejects reference to non-existent id", () => {
      const flow = makeValidFlow({
        routines: {
          main: {
            params: [],
            steps: [
              {
                type: "loop",
                id: "l",
                maxIterations: 3,
                accumulateFrom: ["nonexistent"],
                steps: [{ type: "agent", id: "builder", spec: "build", task: "x" }],
              },
            ],
          },
        },
      });
      const errors = FlowLoader.validateSemantics(flow);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("accumulateFrom references unknown");
      expect(errors[0]).toContain("nonexistent");
    });

    it("accepts accumulateFrom referencing id inside nested parallel", () => {
      const flow = makeValidFlow({
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
                        spec: "review",
                        task: "r",
                        parseJson: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      });
      const errors = FlowLoader.validateSemantics(flow);
      expect(errors).toEqual([]);
    });

    it("rejects accumulateFrom targeting instruction without parseJson", () => {
      const flow = makeValidFlow({
        routines: {
          main: {
            params: [],
            steps: [
              {
                type: "loop",
                id: "l",
                maxIterations: 3,
                accumulateFrom: ["builder"],
                steps: [{ type: "agent", id: "builder", spec: "build", task: "do {{task}}" }],
              },
            ],
          },
        },
      });
      const errors = FlowLoader.validateSemantics(flow);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("accumulateFrom");
      expect(errors[0]).toContain("without parseJson: true");
    });

    it("accepts a loop without accumulateFrom", () => {
      const flow = makeValidFlow({
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
      });
      const errors = FlowLoader.validateSemantics(flow);
      expect(errors).toEqual([]);
    });
  });

  // ── Multiple errors ─────────────────────────────────────

  it("reports multiple semantic errors across routines", () => {
    const errors = FlowLoader.validateSemantics({
      name: "test",
      command: "/test",
      orchestrator: { prompt: "o.md", activeTools: ["does_not_exist"] },
      routines: {
        r1: {
          params: [],
          steps: [
            { type: "workspace", id: "dup" },
            { type: "workspace", id: "dup" },
          ],
        },
        r2: {
          params: [],
          steps: [
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
    });
    // activeTools error + duplicate error + continueWhile error + accumulateFrom error
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  // ── knownSpecs ──────────────────────────────────────────

  describe("knownSpecs", () => {
    it("rejects unknown spec when knownSpecs is provided", () => {
      const errors = FlowLoader.validateSemantics(
        makeValidFlow({
          routines: {
            main: {
              params: [],
              steps: [{ type: "agent", id: "a1", spec: "unknown-spec", task: "do it" }],
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
              steps: [{ type: "agent", id: "a1", spec: "build", task: "do it" }],
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
              steps: [{ type: "agent", id: "a1", spec: "unknown-spec", task: "do it" }],
            },
          },
        }),
        // knownSpecs omitted
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
    loader = new FlowLoader(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("loads and validates a flow package", async () => {
    const flow = makeValidFlow({
      name: "test",
      routines: {
        main: {
          params: [{ name: "task" }],
          steps: [
            { type: "workspace", id: "ws" },
            { type: "cleanup", id: "cleanup" },
          ],
        },
      },
    });
    await writeFlowPkg(tempDir, "test", flow);

    const loaded = await loader.load("test");
    expect(loaded.name).toBe("test");
    expect(Object.keys(loaded.routines)).toHaveLength(1);
  });

  it("loads the real implement flow package", async () => {
    const realLoader = new FlowLoader(path.join(__dirname, "..", "flows"));
    const flow = await realLoader.load("implement");
    expect(flow.name).toBe("implement");
    expect(Object.keys(flow.routines).length).toBeGreaterThan(0);
    expect(flow.routines.run_build_loop).toBeDefined();
    expect(flow.routines.destroy_workspace).toBeDefined();
  });

  it("throws for non-existent flow package", async () => {
    await expect(loader.load("nonexistent")).rejects.toThrow("not found");
  });

  it("throws for invalid JSON", async () => {
    const pkgDir = path.join(tempDir, "bad");
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(path.join(pkgDir, "flow.json"), "not json");
    await expect(loader.load("bad")).rejects.toThrow("contains invalid JSON");
  });

  it("throws for semantically invalid flow (duplicate ids)", async () => {
    const flow: FlowDefinition = {
      name: "dup",
      command: "/dup",
      orchestrator: { prompt: "o.md" },
      routines: {
        main: {
          params: [],
          steps: [
            { type: "workspace", id: "dup" },
            { type: "workspace", id: "dup" },
          ],
        },
      },
    };
    await writeFlowPkg(tempDir, "dup", flow);

    await expect(loader.load("dup")).rejects.toThrow("Duplicate instruction id");
  });

  it("loads a flow package with orchestrator.md alongside flow.json", async () => {
    const flow = makeValidFlow({
      name: "with_md",
      routines: {
        main: {
          params: [],
          steps: [{ type: "cleanup", id: "c" }],
        },
      },
    });
    await writeFlowPkg(tempDir, "with_md", flow, "# Orchestrator prompt\n\n{{task}}");

    const loaded = await loader.load("with_md");
    expect(loaded.name).toBe("with_md");
  });

  describe("loadAll", () => {
    it("returns all flow packages", async () => {
      await writeFlowPkg(
        tempDir,
        "a",
        makeValidFlow({
          name: "a",
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "ws" },
                { type: "cleanup", id: "c" },
              ],
            },
          },
        }),
      );
      await writeFlowPkg(
        tempDir,
        "b",
        makeValidFlow({
          name: "b",
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "ws" },
                { type: "cleanup", id: "c" },
              ],
            },
          },
        }),
      );

      const { flows, failures } = await loader.loadAll();
      expect(flows.size).toBe(2);
      expect(flows.has("a")).toBe(true);
      expect(flows.has("b")).toBe(true);
      expect(failures.size).toBe(0);
    });

    it("ignores directories without flow.json", async () => {
      await writeFlowPkg(
        tempDir,
        "flow1",
        makeValidFlow({
          name: "flow1",
          routines: {
            main: { params: [], steps: [{ type: "cleanup", id: "c" }] },
          },
        }),
      );
      // Create a directory without flow.json
      await fs.mkdir(path.join(tempDir, "not_a_flow"), { recursive: true });

      const { flows } = await loader.loadAll();
      expect(flows.size).toBe(1);
      expect(flows.has("flow1")).toBe(true);
    });

    it("ignores non-directory entries (like flow-schema.json at top level)", async () => {
      await writeFlowPkg(
        tempDir,
        "myflow",
        makeValidFlow({
          name: "myflow",
          routines: {
            main: { params: [], steps: [{ type: "cleanup", id: "c" }] },
          },
        }),
      );
      // Write a stray file at the top level — should be ignored
      await fs.writeFile(path.join(tempDir, "flow-schema.json"), "{}");
      await fs.writeFile(path.join(tempDir, "readme.md"), "# docs");

      const { flows } = await loader.loadAll();
      expect(flows.size).toBe(1);
      expect(flows.has("myflow")).toBe(true);
    });

    it("collects failures instead of aborting", async () => {
      await writeFlowPkg(
        tempDir,
        "good",
        makeValidFlow({
          name: "good",
          routines: {
            main: {
              params: [],
              steps: [
                { type: "workspace", id: "ws" },
                { type: "cleanup", id: "c" },
              ],
            },
          },
        }),
      );
      // Invalid flow package — duplicate ids
      await writeFlowPkg(tempDir, "bad", {
        name: "bad",
        command: "/bad",
        orchestrator: { prompt: "o.md" },
        routines: {
          main: {
            params: [],
            steps: [
              { type: "workspace", id: "dup" },
              { type: "workspace", id: "dup" },
            ],
          },
        },
      });

      const { flows, failures } = await loader.loadAll();
      expect(flows.size).toBe(1);
      expect(flows.has("good")).toBe(true);
      expect(failures.size).toBe(1);
      expect(failures.has("bad")).toBe(true);
      expect(failures.get("bad")!.message).toContain("Duplicate instruction id");
    });

    it("returns empty when no flow packages present", async () => {
      const { flows, failures } = await loader.loadAll();
      expect(flows.size).toBe(0);
      expect(failures.size).toBe(0);
    });
  });
});
