import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";

import {
  AgentConfigSchema,
  AgentModelConfigSchema,
  ForgeConfigSchema,
  LogLevel,
  WorkspaceProviderKind,
} from "./ForgeConfigSchema";

describe("AgentModelConfigSchema", () => {
  it("validates a complete model config", () => {
    const valid = { model: "gpt-4o", provider: "openai" };
    expect(Value.Check(AgentModelConfigSchema, valid)).toBe(true);
  });

  it("validates a minimal model config (no provider)", () => {
    const valid = { model: "claude-sonnet-4-5" };
    expect(Value.Check(AgentModelConfigSchema, valid)).toBe(true);
  });

  it("rejects a model config without model", () => {
    expect(Value.Check(AgentModelConfigSchema, { provider: "anthropic" })).toBe(false);
  });

  it("rejects a model config with non-string model", () => {
    expect(Value.Check(AgentModelConfigSchema, { model: 42 })).toBe(false);
  });
});

describe("AgentConfigSchema", () => {
  it("validates an empty agent config (all optionals)", () => {
    expect(Value.Check(AgentConfigSchema, {})).toBe(true);
  });

  it("validates a full agent config", () => {
    const valid = {
      model: { model: "claude-sonnet-4-5" },
      maxToolCalls: 50,
      maxTurns: 200,
    };
    expect(Value.Check(AgentConfigSchema, valid)).toBe(true);
  });

  it("rejects negative maxToolCalls", () => {
    expect(Value.Check(AgentConfigSchema, { maxToolCalls: -1 })).toBe(false);
  });

  it("rejects zero maxTurns", () => {
    expect(Value.Check(AgentConfigSchema, { maxTurns: 0 })).toBe(false);
  });

  it("rejects invalid model sub-object", () => {
    expect(Value.Check(AgentConfigSchema, { model: { provider: "openai" } })).toBe(false);
  });
});

describe("ForgeConfigSchema", () => {
  it("validates a complete forge config", () => {
    const valid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: {
        model: { model: "gpt-4" },
        maxToolCalls: 40,
        maxTurns: 100,
      },
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("accepts all LogLevel values", () => {
    const base = {
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
    };
    for (const level of Object.values(LogLevel)) {
      expect(Value.Check(ForgeConfigSchema, { ...base, logLevel: level })).toBe(true);
    }
  });

  it("accepts all WorkspaceProviderKind values", () => {
    const base = {
      logLevel: "info",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
    };
    for (const provider of Object.values(WorkspaceProviderKind)) {
      expect(Value.Check(ForgeConfigSchema, { ...base, workspaceProvider: provider })).toBe(true);
    }
  });

  it("rejects unknown log level", () => {
    const invalid = {
      logLevel: "verbose",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
    };
    expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
  });

  it("rejects unknown workspace provider", () => {
    const invalid = {
      logLevel: "info",
      workspaceProvider: "docker",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
    };
    expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
  });

  it("accepts a config omitting logLevel (default applied at resolution)", () => {
    const valid = {
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("accepts a config omitting workspaceProvider", () => {
    const valid = {
      logLevel: "info",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("accepts a config omitting agents", () => {
    const valid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      defaultAgent: { model: { model: "gpt-4" } },
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("accepts a config omitting defaultAgent", () => {
    const valid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("accepts a config with only logPrefix (all defaulted fields omitted)", () => {
    const valid = { logPrefix: "x" };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);

    // Decode must not inject the defaulted fields - they stay absent at
    // the schema level and are filled later by resolveConfig.
    const decoded = Value.Decode(ForgeConfigSchema, valid);
    expect(decoded.logPrefix).toBe("x");
    expect(decoded).not.toHaveProperty("logLevel");
    expect(decoded).not.toHaveProperty("workspaceProvider");
    expect(decoded).not.toHaveProperty("agents");
    expect(decoded).not.toHaveProperty("defaultAgent");
  });

  it("accepts an empty config object (no required fields)", () => {
    expect(Value.Check(ForgeConfigSchema, {})).toBe(true);
  });

  it("accepts optional logDir field", () => {
    const valid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      logDir: "/custom/logs",
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("accepts optional worktreeSymlinks field", () => {
    const valid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      worktreeSymlinks: ["config", "secrets"],
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("accepts optional taskTimeoutMs field", () => {
    const valid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      taskTimeoutMs: 5000,
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("rejects taskTimeoutMs less than 1", () => {
    const invalid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      taskTimeoutMs: 0,
    };
    expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
  });

  it("rejects taskTimeoutMs as non-integer", () => {
    const invalid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      taskTimeoutMs: 500.5,
    };
    expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
  });

  it("accepts optional logRetentionDays field", () => {
    const valid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      logRetentionDays: 7,
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("accepts logRetentionDays of 0 to disable pruning", () => {
    const valid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      logRetentionDays: 0,
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("rejects negative logRetentionDays", () => {
    const invalid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      logRetentionDays: -1,
    };
    expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
  });

  it("rejects non-integer logRetentionDays", () => {
    const invalid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      logRetentionDays: 7.5,
    };
    expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
  });

  it("accepts optional logPayloads field", () => {
    const valid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      logPayloads: true,
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("rejects non-boolean logPayloads", () => {
    const invalid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      logPayloads: "yes",
    };
    expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
  });

  it("accepts optional specDirectories field", () => {
    const valid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      specDirectories: {
        flows: ["./custom-flows"],
        agents: ["./custom-agent-specs"],
      },
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("accepts empty specDirectories", () => {
    const valid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {},
      defaultAgent: { model: { model: "gpt-4" } },
      specDirectories: {},
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  it("accepts agents with per-agent overrides", () => {
    const valid = {
      logLevel: "debug",
      workspaceProvider: "current-dir",
      agents: {
        "builder-agent": { maxTurns: 50 },
        "reviewer-agent": { maxTurns: 30, model: { model: "claude-sonnet-4-5" } },
      },
      defaultAgent: { model: { model: "gpt-4" }, maxTurns: 100 },
    };
    expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
  });

  describe("models section", () => {
    it("validates a complete forge config with models section", () => {
      const valid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        models: {
          smart: { model: "claude-sonnet-4-5" },
          medium: { model: "gpt-4o" },
          dumb: { model: "claude-haiku-4-5" },
        },
      };
      expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
    });

    it("validates config with models and defaultModel", () => {
      const valid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        models: {
          smart: { model: "claude-sonnet-4-5" },
        },
        defaultModel: "smart",
      };
      expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
    });

    it("validates config with empty models map", () => {
      const valid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        models: {},
      };
      expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
    });

    it("validates config without models field (optional)", () => {
      const valid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
      };
      expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
    });

    it("validates config without defaultModel field (optional)", () => {
      const valid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        models: { smart: { model: "claude-sonnet-4-5" } },
      };
      expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
    });

    it("validates config with a piCli path", () => {
      const valid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        piCli: "/usr/local/bin/pi-cli.js",
      };
      expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
    });

    it("rejects piCli with a non-string value", () => {
      const invalid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        piCli: 42,
      };
      expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
    });

    it("rejects models with a non-object value", () => {
      const invalid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        models: "not-an-object",
      };
      expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
    });

    it("rejects a model preset without model field", () => {
      const invalid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        models: {
          smart: { provider: "anthropic" },
        },
      };
      expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
    });

    it("rejects a model preset with non-string model", () => {
      const invalid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        models: {
          smart: { model: 42 },
        },
      };
      expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
    });

    it("validates a model preset with thinkingLevel", () => {
      const valid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        models: {
          smart: { model: "claude-sonnet-4-5", thinkingLevel: "high" },
        },
      };
      expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
    });

    it("validates a model preset without thinkingLevel (optional)", () => {
      const valid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        models: {
          smart: { model: "claude-sonnet-4-5" },
        },
      };
      expect(Value.Check(ForgeConfigSchema, valid)).toBe(true);
    });

    it("rejects a model preset with empty thinkingLevel", () => {
      const invalid = {
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        models: {
          smart: { model: "gpt-4o", thinkingLevel: "" },
        },
      };
      expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
    });
  });

  it("rejects agents with invalid values", () => {
    const invalid = {
      logLevel: "info",
      workspaceProvider: "git-worktree",
      agents: {
        "bad-agent": { maxToolCalls: "many" },
      },
      defaultAgent: { model: { model: "gpt-4" } },
    };
    expect(Value.Check(ForgeConfigSchema, invalid)).toBe(false);
  });
});
