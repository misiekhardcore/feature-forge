# ADR 0017: Static utility classes for flow validation and skill resolution

**Date:** 2026-08-18
**Status:** Accepted

## Context

Two cli modules are pure, state-free function collections:

- `packages/cli/src/orchestrator/flowValidation.ts` - structural and semantic
  flow validation (TypeBox schema check plus duplicate-id, expression,
  accumulateFrom, workspace-ref, and unknown-spec/provider rules).
- `packages/cli/src/agents/specifications/skill-resolver.ts` - skill name
  discovery and allowlist/denylist resolution over the well-known skill
  directories.

`docs/architecture-review.md` findings 17-18 recommended converting both to
plain functions + module-level constants. The phase plan for this work
directed the static-class shape instead, for consistency with the existing
static-only utility precedent in the codebase (`ExpressionEvaluator` in
`packages/cli/src/orchestrator/ExpressionEvaluator.ts`). Earlier commits
(`c43ba2a2`, `74a49b8c`) had implemented the plain-function form; they were
replaced by the plan-directed class form. Neither module holds instance
state in either shape, so this is a pure API-shape decision.

## Decision

Expose both modules as static-only classes:

- **`FlowValidation`** - public statics `validateStructure` (asserts
  `value is FlowDefinition`) and `validateSemantics`; 10 private static
  helpers (`validateRoutineSteps`, `checkDuplicateIds`, `collectIds`,
  `walkInstructions`, `checkAgentWorkspaceRef`, `checkLoopExpression`,
  `checkAccumulateFrom`, `collectAllIds`, `collectIdsByFlag`,
  `collectIdsByType`).
- **`SkillResolver`** - public statics `bundledSkillDirectories`,
  `resolveSkillPaths`, `discoverAllSkills`, `resolveEffectiveSkillNames`;
  3 private static helpers (`skillDirectories`, `parseSkillName`,
  `scanDirectory`). Module-private constants (`DEFAULT_FORGE_DIR`, skill
  directory paths) and the `SkillMetadata` interface stay module-scoped.

Both classes declare a `private constructor()` so they cannot be
instantiated.

The cli package index (`packages/cli/src/agents/specifications/index.ts`)
now exports the `SkillResolver` class, replacing the three named function
exports (`discoverAllSkills`, `resolveEffectiveSkillNames`,
`resolveSkillPaths`). `FlowValidation` is consumed via direct module import
(`./orchestrator/flowValidation`) and is not re-exported from any barrel.

## Consequences

- **Class-qualified call sites** - `FlowLoader`, `scripts/validate-flow.ts`,
  `factories/helpers.ts`, and the test files call the static members through
  the class name; `this.`-qualified private calls are compile-time checked.
- **Type-verifiable internals** - `collectIdsByFlag` narrows on
  `instruction.type === "agent"` before the indexed flag access, replacing
  the dynamic `flag in instruction` check the compiler could not verify
  against the instruction union (architecture-review 3.9 follow-up).
- **Export-surface change** - the three removed function exports are a
  breaking change for any external consumer of the cli package index; the
  package is internal to this repository, so no external migration is
  needed.
- **No behavior change** - the transformation is mechanical; error messages,
  signatures, and thrown/returned contracts are unchanged.

## References

- ADR 0002 - schema accuracy and semantic validation
- Architecture review findings 17-18 (plain-functions recommendation,
  superseded by this ADR for these two modules) and 3.9 (typed
  `collectIdsByFlag`)
- Precedent: `packages/cli/src/orchestrator/ExpressionEvaluator.ts`
- Source: `packages/cli/src/orchestrator/flowValidation.ts`,
  `packages/cli/src/agents/specifications/skill-resolver.ts`
