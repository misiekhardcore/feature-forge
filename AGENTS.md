# feature-forge

Autonomous software engineering platform — idea-to-PR via structured discovery, ADR-driven design, and multi-agent implementation.

## Code validation — required before finishing any change

Run these in order. A change is not done until all pass cleanly.

```bash
npm run lint          # eslint .
npm run format        # prettier --check .
npm run typecheck     # tsc --noEmit
npm run test          # vitest run
npm test -- --coverage  # coverage with thresholds
```

Or use the combined script: `npm run check` (lint → format → test — does NOT include typecheck or coverage).

### Known failures / exemptions

- **AgentFactory.ts line 27** (`cause?: Error` parameter): The `cause instanceof Error ? cause : undefined` ternary has an unreachable `undefined` branch. PiSubprocessAgent converts non-Errors to Errors before rethrowing, so the ternary always evaluates to `cause`. This is dead code — do not add coverage-only tests for it.

## Coverage

- Thresholds: 90% lines, statements, functions, branches.
- Test files are co-located next to source files (`src/**/*.test.ts`).
- `src/test-utils.ts` is excluded from coverage (test infrastructure).
- `src/index.ts` and `src/**/index.ts` (barrel files) are excluded from coverage.

## Project structure

```
src/
├── agents/
│   ├── agents/           # Agent implementations (PiSubprocessAgent)
│   ├── base/             # Base types (AgentIdentifier, AgentStatus)
│   ├── factories/        # Agent factories
│   ├── policies/         # Governance policies
│   ├── specifications/   # Agent specifications
│   └── supervisors/      # Agent supervisors
├── commands/             # CLI commands (ResearchCommand, etc.)
├── registry/             # Registry, CommandRegistry, ToolRegistry
├── tools/                # Tool definitions
├── index.ts              # Pi extension entry point
└── test-utils.ts         # Shared test helpers
```

## Coding conventions

### SOLID & design principles

- **Single Responsibility** — each class (or function) owns exactly one concern. If a class has more than ~5-7 public methods or is doing I/O + logic + formatting, split it.
- **Open/Closed** — extend behaviour via subclassing or DI, not by modifying existing classes. Abstract base classes + concrete implementations (`AgentGovernancePolicy` → `DefaultAgentGovernancePolicy`).
- **Liskov Substitution** — every subclass must be usable wherever its parent is expected. No weakening of preconditions or strengthening of postconditions.
- **Interface Segregation** — small, focused abstract classes over large interfaces. Consumers depend only on what they use.
- **Dependency Injection** — dependencies are passed in (constructor params), not created internally. Makes testing and substitution straightforward.
- **DRY** — extract repeated logic into shared helpers (`buildPiCliArguments()`, test utilities), not by copying code. One exception: test fixtures may repeat similar patterns for readability.

### File & module scoping

- **Small files** — prefer many small files over a few large ones. If a file exceeds ~200 lines, it's a candidate for splitting.
- **One primary export per file** — the file is named after its main export (e.g., `AgentIdentifier.ts` exports `AgentIdentifier`). Supporting types may be exported from the same file only if they're small and tightly coupled.
- **No monoliths** — no god classes, no utility files that do everything, no 500+ line modules.
- **Barrel files** (`index.ts`) re-export from sibling modules. They exist only for convenience — never put logic in an index file.

### Naming

- **Self-explanatory names** — the name should tell you what it is or does without reading the body. `buildPiCliArguments` > `buildArgs`, `AgentIdentifier` > `AgentId`, `resolvePermissions` > `getPerms`.
- **No abbreviations** — write `specification` not `spec`, `identifier` not `id` (exception: `id` in casual/obvious contexts like variable names that shadow the formal term). `Promise` stays as `Promise`.
- **No one-letter variable names** — no `i`, `j`, `k`, `x`, `y`, `tmp`, `val`, `obj`, `arr`, `fn`, `cb`. Use descriptive names even in loops: `for (const item of items)` not `for (const i of items)`.
- **PascalCase** for classes, types, enums.
- **camelCase** for functions, methods, variables, parameters.
- **UPPER_CASE** for constants that are truly immutable primitives at the module level (rare; prefer `const` + camelCase).

### TypeScript

- **strict mode** (`strict: true` in tsconfig) — no `any` casts. Use `unknown` + type guards instead.
- **ES2022 target**, **ESNext modules**, **bundler module resolution**.
- **No path aliases** — all internal imports are relative.
- **No explicit file extensions** in imports (bundler handles resolution).
- Barrel imports for sibling directories (`from "../base"`, `from "../specifications"`).
- `import type` for type-only imports.
- Underscore prefix (`_`) for intentionally unused parameters/variables.

### Classes & naming

- **PascalCase files** for class modules (`AgentIdentifier.ts`, `Registry.ts`).
- **camelCase files** for utility/helper modules (`helpers.ts`, `test-utils.ts`).
- **Single class per file**, named exports throughout.
- **Abstract base classes** with `public abstract` methods; concrete implementations use `override`.
- **Params object pattern** for constructors — take a single `params: {...}` object instead of positional args.
- **Readonly public fields** set in constructor; no private setters.
- **Value objects** implement `equals()` and `toString()`.
- **JSDoc** on every exported class, method, and non-trivial field.

### Testing (vitest)

- **Co-located** — each `src/path/Module.ts` has a `src/path/Module.test.ts` next to it.
- **Structure**: `describe("ModuleName")` → `describe("methodName")` → `it("behaviour description")`.
- **Test descriptions** are complete sentences starting with lowercase (e.g., `"creates an identifier with a valid string"`).
- **Shared helpers** live in `src/test-utils.ts` — `makeSpec()`, `MockAgent`, `makeMockFactory()`, `makeMockPi()`, `makeMockCtx()`.
- **RpcClient mocking**: use `vi.hoisted()` + `vi.mock()` pattern. Mock constructor must be a plain `function` (not arrow, since arrow functions aren't constructable with `new`). The `beforeEach` calls `resetRpcMock()` to get fresh `vi.fn()` instances.
- **MockAgent for supervisor/command tests**: avoids RpcClient dependency, keeps tests fast and isolated.

### Error handling

- **Custom Error subclasses** (`AgentCreationError extends Error`) with descriptive `name`.
- `cause?: Error` for chaining; errors are always normalized to `Error` instances before propagation.

### Async

- **async/await** exclusively — no explicit `new Promise(...)` constructors, no `.then()` chains.

### Formatting (Prettier)

- Double quotes, semicolons required, trailing commas everywhere.
- 100 char print width, 2-space tabs.

## Tips

- When moving test files, update all relative import paths manually — there is no automatic refactoring.
- `vi.mock` + `vi.hoisted` pattern: `vi.hoisted()` sets up mock state before `vi.mock()` factory runs (avoids TDZ). Mock constructors must be plain `function`, not arrow functions.
- Use `MockAgent` + `makeMockFactory` for supervisor/command tests to avoid RpcClient dependency.
