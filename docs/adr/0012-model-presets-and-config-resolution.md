# ADR 0012: Model presets — aliases, resolution, and config integration

**Date:** 2026-07-30
**Status:** Accepted

## Context

Before this change, model selection had no indirection layer. Every agent
spec frontmatter and config override used raw model strings (e.g.
`"claude-sonnet-4-5"`). There was no shared vocabulary ("smart", "cheap")
that the team could agree on, and flow JSON agent steps had no `model`
field at all — per-step model overrides were impossible.

Additionally, `thinkingLevel` had no integration with model presets. It
existed as a separate field on `AgentSpecification` (wired through
`FORGE_SPEC` → child-side `pi.setThinkingLevel()`), but could not be
declared in model presets or flow agent steps.

Two distinct consumer paths needed to be addressed:

1. **Subprocess agents** (build, review, verify) — spawned via
   `PiSubprocessAgentFactory`, which passes `model` and `provider` to
   `RpcClient`. Resolution happens at the factory boundary.
2. **In-session agents** (orchestrator persona) — mounted via
   `InSessionAgent` inside the main pi process. Resolution happens in
   `OrchestratorCommand.handler()`, using pi's runtime model registry
   (`ctx.modelRegistry.getAvailable()` + `pi.setModel()`).

## Decision

### 1. `models` as a top-level config section

A new `models` record on `ForgeConfigSchema`, mapping preset names to
`AgentModelConfig` objects:

```jsonc
{
  "models": {
    "smart": { "model": "deepseek-v4-pro", "thinkingLevel": "xhigh" },
    "medium": { "model": "deepseek-v4-flash", "thinkingLevel": "high" },
    "dumb": { "model": "deepseek-v4-flash", "thinkingLevel": "medium" },
  },
  "defaultModel": "medium",
}
```

**Why top-level, not nested inside `agents` or `defaultAgent`?**
Model presets are a vocabulary shared across all agents. Nesting them inside
per-agent config would force duplication or referencing. A top-level
dictionary is a single source of truth — agents reference it by alias name.

**Why `defaultModel` as a string key into `models`?**
The `models` map is the authoritative list of known presets. `defaultModel`
is a key reference, not an inline config, to enforce that default choices
are always drawn from the defined vocabulary (no ad-hoc fallbacks).

### 2. `resolveModel` as a pure function

```ts
export function resolveModel(
  rawModel: string | undefined,
  models: Readonly<Record<string, AgentModelConfig>>,
): AgentModelConfig | undefined;
```

**Why a pure function, not a class with DI?**
The resolution logic is stateless: input string + models map → output
`AgentModelConfig` (or passthrough). No side effects, no async, no
configuration. A pure function is trivially testable and injectable into
both the factory (constructor parameter) and the orchestrator command
(import + call). A class would add ceremony without benefit.

**Resolution rule:** If `rawModel` matches a key in `models`, return the
preset. Otherwise, treat it as a raw model string and return
`{ model: rawModel }`. This preserves backward compatibility — existing
specs with raw model strings continue to work unchanged.

### 3. Two resolution points

**Subprocess agents:** `PiSubprocessAgentFactory` resolves
`specification.model` against the models map passed to its constructor.
The resolved `model` and `provider` go to `RpcClient`, while resolved
`thinkingLevel` is applied to the spec via `toJSON()` + reconstruction
(so it flows through `FORGE_SPEC` serialization to the child process).

**In-session agents:** `OrchestratorCommand.handler()` resolves
`this.spec.model` against forge config, looks up the matching `Model<any>`
in `ctx.modelRegistry.getAvailable()`, and calls `pi.setModel(match)` +
`pi.setThinkingLevel()`.

**Why two separate resolution points instead of one unified pipeline?**
The two agent types have fundamentally different model-setting mechanisms:

- Subprocess agents receive model config at spawn time (CLI args to a new
  process). The factory is the natural gate.
- In-session agents change the current pi session's model at runtime
  via `pi.setModel()`, which requires a live `Model<any>` object from pi's
  model registry. This can only happen inside the session.

Unifying them would require either (a) exposing pi's model registry to the
factory (which runs before the session exists), or (b) deferring all model
resolution to the in-session path (which doesn't cover subprocess spawn).
The two-point approach is the pragmatic minimum — each resolves at the
last point where the required mechanism is available.

### 4. `thinkingLevel` priority: explicit spec > preset

When both the spec frontmatter and the resolved model preset declare a
`thinkingLevel`, the spec wins:

```ts
if (this.spec.thinkingLevel) {
  this.pi.setThinkingLevel(this.spec.thinkingLevel); // explicit wins
} else if (resolvedModel?.thinkingLevel) {
  this.pi.setThinkingLevel(resolvedModel.thinkingLevel); // preset fallback
}
```

**Why explicit-over-preset?**
A spec author who writes `thinkingLevel: "low"` in a frontmatter is making
a deliberate choice for that particular agent persona. Overriding it with
a preset value (e.g. `"xhigh"` from the "smart" preset) would violate the
author's intent. The preset provides a sensible default; explicit values
narrow or override it.

This priority chain applies identically in both resolution points
(factory and orchestrator command).

### 5. `AgentModelConfigSchema` extended with `thinkingLevel`

The preset shape is now:

```ts
{
  model: string;           // required — model identifier
  provider?: string;       // optional — provider hint
  thinkingLevel?: string;  // optional — ThinkingLevel union
}
```

`temperature`, `maxTokens`, and other model parameters remain out of scope.
`thinkingLevel` was included because it is pi's own abstraction (the same
6 literals regardless of LLM provider), making it universally meaningful
across presets.

### 6. `model` and `thinkingLevel` in flow JSON agent steps

`AgentInstructionSchema` gained two optional fields:

```jsonc
{
  "type": "agent",
  "id": "builder",
  "model": "smart",
  "thinkingLevel": "high",
  "systemPrompt": "build.md",
  "prompt": "$TASK",
}
```

Both are collected into a single `createDynamic()` call in
`AgentStepExecutor`, alongside `cwd`, avoiding the N+1 allocation pattern
from prior iterations.

### 7. Config file location: `.forge/config.json`

The authoritative config file lives at `.forge/config.json`, the first
path checked by `ConfigLoader.forRoot()`. The repo-root `forge.config.json`
remains as a fallback. This keeps config co-located with other forge
state (worktrees at `.forge/worktrees/`, logs at `.forge/logs/`).

`forge init` appends `# Feature Forge runtime` plus the runtime-artifact
entries `.forge/worktrees`, `.forge/worktrees.json`, and `.forge/logs` to
the project's `.gitignore`, so the config, agents, flows, and skills under
`.forge/` remain tracked while runtime artifacts stay ignored.

## Consequences

- **Positive:** Model presets provide a shared vocabulary. Changing the
  underlying model for "smart" updates all consumers in one place.
- **Positive:** Flow JSON authors can now override model and thinkingLevel
  per agent step without modifying spec files.
- **Positive:** `thinkingLevel` is a first-class preset property, making
  reasoning-effort configuration discoverable and co-located with model choice.
- **Negative:** Two resolution points (factory + orchestrator command) must
  stay in sync. Changes to the `AgentModelConfig` shape require updates in
  both locations.
- **Negative:** Orchestrator model change depends on `ctx.modelRegistry`,
  which is only available in-session. If a flow ever needs to change the
  main session's model from a subprocess agent, this design doesn't support it.
- **Neutral:** `defaultModel` is validated only at the TypeBox level (must be a
  string). Cross-field validation (key existence in `models`) is deferred to
  runtime consumers. This is intentional — TypeBox can't express cross-field
  constraints, and runtime consumers already handle missing keys gracefully.

## Alternatives considered

### Single unified resolution point

Move all model resolution into `AgentSpecification` construction, before
any agent is spawned or mounted. Rejected because:

- Subprocess model resolution needs `Model<any>` from pi's registry for
  in-session agents, but the factory doesn't have registry access.
- Deferring all resolution to the orchestrator command means subprocess
  agents can't benefit from presets (they're spawned before the command runs).

### `thinkingLevel` as a separate config domain

Keep `thinkingLevel` out of model presets and require it to be set
separately per spec. Rejected because:

- Model choice and reasoning effort are coupled — a "smart" model implies
  higher thinking effort; a "dumb" model implies lower.
- The user would need to configure both `model: "smart"` and
  `thinkingLevel: "high"` separately for every agent, doubling config
  surface for no benefit.

### Using `pi.registerProvider()` for orchestrator model change

Register models at extension load time, then look them up later. Rejected
because:

- `registerProvider()` requires `apiKey` and `baseUrl` — secrets that
  don't belong in forge config.
- The user already authenticated providers through pi's own auth flow;
  models are already in pi's registry. Re-registering them would duplicate
  configuration.
- `ctx.modelRegistry.getAvailable()` already provides the authenticated
  models without extra setup.

### Nesting `models` inside `defaultAgent`

Put the presets map inside the existing agent config hierarchy. Rejected
because presets are a shared vocabulary — nesting them under `defaultAgent`
implies they're only relevant to the default, when in fact any agent can
reference them.

### `resolveModel` as a class with DI

Wrap the resolution in a class with injectable dependencies. Rejected
because the function is pure and stateless. A class would add boilerplate
(interface, constructor, DI wiring) with no benefit for a mapping that's
inherently a lookup table + passthrough.
