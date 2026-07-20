# feature-forge

Autonomous software engineering platform. Priority: minimal, scoped changes; strict architectural adherence.

## Architectural Guardrails

### Agent Hierarchy & Interaction

Agents are separated by identity (Base) and interaction model (Subprocess vs In-Session).

- **Base `Agent`**: Identity and lifecycle (`id`, `specification`, `status`, `destroy`).
- **`SubprocessAgent`**: Separate process / RPC transport (`executeTask`, `getResult`).
- **`InSessionAgent`**: Runs inside current pi session (`mount`).
- **Concretes**: `PiSubprocessAgent` and `SessionAgent`.
- **Details**: See `docs/adr/0007-agent-hierarchy-subprocess-vs-in-session.md`.

### The Orchestrator Distinction

**The Orchestrator is a deterministic engine that follows a flow file. It is NOT an LLM and DOES NOT extend Agent.**
The `SessionAgent` (with an orchestrator persona) drives the Orchestrator via routine tools.

- **Details**: See `docs/adr/0007-agent-hierarchy-subprocess-vs-in-session.md`.

### Persona/Spec Pipeline

Specs are resolved by frontmatter `id`, not filename:
`SpecLoader` (Parser) $\to$ `SpecManager` (Orchestrator) $\to$ `SpecRegistry` (Storage).

- **Details**: See `docs/adr/0007-agent-hierarchy-subprocess-vs-in-session.md` (Spec loading unification).

## Working Rules

- **Scope**: ❌ Avoid speculative abstractions or broad refactors $\to$ ✅ Prefer the smallest change that satisfies the task.
- **Discovery**: ❌ Avoid guessing patterns $\to$ ✅ Read existing files and established abstractions before editing.
- **Workflow**: ❌ Avoid modifying files outside a worktree $\to$ ✅ Use a git worktree; maintain tight scope.
- **Testing**: ❌ Avoid detached implementation $\to$ ✅ Add/update tests near affected code when behavior changes.
- **Documentation**: ❌ Avoid undocumented architectural shifts $\to$ ✅ Update an ADR in `docs/adr` for any new abstraction or public API.
- **Concurrency**: ❌ Avoid assuming shared in-memory state $\to$ ✅ Use explicit interfaces and serializable data for inter-process communication.
- **Consistency**: ❌ Avoid divergent styles $\to$ ✅ Follow existing naming and TypeScript conventions of the surrounding package.
- **TUI rendering**: ❌ Never use raw `.length` or `.slice()` to measure or truncate strings that may contain ANSI escape codes, OSC hyperlinks, or multi-byte characters $\to$ ✅ Always use `visibleWidth()` to measure and `truncateToWidth()` / `wrapTextWithAnsi()` from `@earendil-works/pi-tui` to truncate. Measure twice, cut once — raw string length is not display width.

## Procedural Workflows

### Validation Loop

1. `npm run fix` — Apply automatic fixes.
2. `npm run lint` — Verify style and rule adherence.
3. `npm run typecheck` — Ensure type safety.
4. `npm run test` — Verify functional correctness.
5. `npm test -- --coverage` — Check coverage impact.

## Reference

- **General Guidance**: `README.md`, `PLAN.md`
- **Architectural Decisions**: `docs/adr` (Required before non-trivial implementation changes)
