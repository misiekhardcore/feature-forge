# Contributing to Feature Forge

Feature Forge is an autonomous software engineering platform — idea-to-PR via structured discovery, ADR-driven design, and multi-agent implementation. Contributions are welcome.

## Repository structure

This is a **Turborepo monorepo** with npm workspaces:

- **`@feature-forge/cli`** (`packages/cli/`) — main pi extension, orchestrator, step executors, IPC agents
- **`@feature-forge/shared`** (`packages/shared/`) — shared base types and abstractions
- **`@feature-forge/eslint-config`** (`packages/eslint-config/`) — shared ESLint configuration
- **`@feature-forge/web`** (`packages/web/`) — web UI (TBD)

See [AGENTS.md](AGENTS.md) for the full project structure and coding conventions.

## Development setup

```bash
git clone https://github.com/misiekhardcore/feature-forge.git
cd feature-forge
npm install
```

### Prerequisites

- **Node.js** >= 22 (see `.nvmrc` or `.node-version` if present)
- **npm** >= 11 (shipped with Node)
- **pi** (the coding agent CLI) — Feature Forge runs as a pi extension

## Scripts

| Command              | Description                                    |
| -------------------- | ---------------------------------------------- |
| `npm test`           | Run tests (vitest, all packages)               |
| `npm run test:watch` | Run tests in watch mode                        |
| `npm run lint`       | Check code style (turbo, all packages)         |
| `npm run lint:fix`   | Auto-fix lint issues (turbo, all packages)     |
| `npm run format`     | Check formatting (turbo, all packages)         |
| `npm run format:fix` | Auto-fix formatting (turbo, all packages)      |
| `npm run fix`        | Combined: lint:fix + format:fix                |
| `npm run typecheck`  | TypeScript type checking (turbo, all packages) |
| `npm run check`      | Combined: lint + format + test (not typecheck) |
| `npm run build`      | Build all packages via turbo                   |
| `npm run changelog`  | Generate CHANGELOG.md from commits             |

Run commands inside a specific package:

```bash
npm -w @feature-forge/cli run test
npm -w @feature-forge/shared run lint
```

## Conventions

- **TypeScript** with ES modules (`"type": "module"`)
- **strict mode** — no `any` casts, use `unknown` + type guards
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
- **Formatting** via Prettier (automated, enforced in CI)
- **Linting** via ESLint with typescript-eslint (automated, enforced in CI)
- **Tests** via Vitest, co-located with source files
- All code changes must pass validation before opening a PR (see AGENTS.md)

## Pull requests

1. Create a feature branch from `main`
2. Make your changes (prefer creating a git worktree for isolation)
3. Run `npm run check` to verify lint, format, and tests
4. Run `npm run typecheck` for full type safety validation
5. Open a PR against `main` with a descriptive title and summary

## Release process

1. Merge PRs to `main`
2. Tag a release: `git tag v0.1.0 && git push --tags`
3. The release workflow generates a changelog and creates a GitHub release

## Design decisions

Architecture Decision Records (ADRs) live in [docs/adr/](docs/adr/). Create or update an ADR when introducing new abstractions, changing public APIs, agent lifecycle, communication protocols, or extension architecture.
