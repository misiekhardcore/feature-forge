# ADR 0021: Result-path walking and template resolution (unification, roadmap p1b / finding 3.6)

**Date:** 2026-08-25
**Status:** Accepted (implemented by the p1b implementation)

## Context

Architecture review finding 3.6 catalogued four template/expression engines
with divergent semantics:

- `FlowContext.resolve` (orchestrator) - `{{token}}` substitution plus
  `results.<id>.<path>` resolution.
- `ExpressionEvaluator` / `ExpressionParser` (loop conditions) - a custom
  grammar for `while` / `continueWhile`.
- `fillTemplate` - production-dead; deleted in #227.
- `OrchestratorCommand.resolveTask` - inline regex + `promptParams`.

Two concrete defects made the divergence user-visible:

- The `FlowInstruction.ts` loop-expression grammar docs advertised `===` /
  `!==` operators, but the lexer did not tokenize `=` at all - any flow
  using the documented operators failed at load time with
  `ParseError: Unexpected character '='`.
- `results.<id>.<path>` walking was duplicated between `resolveNested` and
  `resolvePath` with inconsistent missing-key behavior: `resolveNested`
  returned `""`, `resolvePath` threw.

Roadmap p1b prescribed the unification: one template resolver, one
expression evaluator, one results-path walker, and `fillTemplate` deleted.

## Decision

- **D1 - `ResultPathWalker` (`core/src/flows/ResultPathWalker.ts`) is the single
  results-path walker.** It never throws: every failure is reported
  structurally via a `ResultPathWalk` union (`no-result` |
  `not-traversable {at, key, current}` | `missing-key {at, key}`). Missing-key
  semantics are uniform: absent keys, non-enumerable own keys (e.g. array
  `length`), accessor properties, own enumerable keys whose value is
  `undefined`, and prototype-chain keys (`constructor`, `__proto__`) are all
  treated as absent, and getters are never invoked. Strictness (blank vs
  throw vs `undefined`) is the caller's policy, not the walker's. Exposed as a
  static-only utility class per ADR 0017 (private constructor, `static walk`)
  - no instance state.
- **D2 - `TemplateResolver` (`core/src/flows/TemplateResolver.ts`) is the
  single `{{token}}` engine.** Defined values (including `""`) substitute
  verbatim; `undefined` or `null` keeps the token in place - unknown tokens
  are never silently blanked, so template-authoring mistakes surface in the
  rendered output. Callers that need blanking return `""` from their lookup.
  Exposed as a static-only utility class per ADR 0017 (private constructor,
  `static resolve`) - no instance state.
- **D3 - both template consumers delegate to `TemplateResolver.resolve`.**
  `FlowContext.resolve` supplies a lookup covering `prompt`, `feedback`,
  `params`, `session.` / `workspace.` / `results.` prefixes;
  `OrchestratorCommand.resolveTask` supplies `promptParams` plus the
  `{{prompt}}` override.
- **D4 - `===` / `!==` are implemented in the loop expression grammar**
  (`ExpressionParser` / `ExpressionEvaluator`): raw-value strict equality
  with no type coercion (`'true' === true` is `false`), binding tighter than
  `&&` / `||` and left-associative. `ExpressionEvaluator.resolvePath`
  delegates to `ResultPathWalker.walk` with a strictness policy layer: optional
  segments (`?.`) resolve to `undefined`, required segments throw with the
  legacy error messages preserved. Walking stops at the first failing segment
  (first-failure-wins), so a required segment after an earlier optional miss
  never throws - the whole path short-circuits to `undefined`.

## Consequences

- **Two intentional behavior changes, both inert for shipped flows:**
  1. `OrchestratorCommand.resolveTask` now keeps unknown `promptParams`
     tokens as `{{token}}` instead of blanking them to `""`. This surfaces
     template-authoring bugs; shipped flows use only `{{prompt}}`.
  2. Exotic paths - array `.length`, `constructor` / `__proto__`, accessor
     getters, undefined-valued keys - now resolve as absent (templates blank
     to `""`, expressions throw on required segments) where raw property
     access could previously resolve them. No shipped flow or test depended
     on the old behavior.
- One template engine, one expression evaluator, one results-path walker;
  `fillTemplate` was already deleted in #227.
- Both new modules are static-only utility classes per ADR 0017 (precedent:
  `ExpressionEvaluator`, `FlowValidation`, `SkillResolver`) - a pure
  API-shape decision with no instance state.
- Loop expressions can now use the documented `===` / `!==` operators - the
  doc-vs-lexer mismatch from finding 3.6 is gone.
