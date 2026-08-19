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

E2E tests (`packages/cli/e2e`) run as the `cli-e2e` vitest project:

```bash
npm run test:e2e
npm -w @feature-forge/cli run test:e2e
```

(npm runs lifecycle scripts with the package as cwd, and vitest resolves
inline project `root` paths against the working directory
(vitest-dev/vitest#6855). The package script passes `--root ../..` to point
vitest at the repository root config, and the config anchors its project
roots at the config file location, so discovery works from any cwd.)

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

Releases are driven from GitHub — the **Release** workflow handles version bumping, changelog generation, tagging, GitHub release creation, and npm publishing. There is no manual tagging.

### Preflight: schema/codegen gate

Before releasing, regenerate the flow schema and verify it is in sync:

1. `npm run flow:generate-schema`
2. `git diff --exit-code -- packages/core/src/flows/flow-schema.json` — must be clean, no drift
3. `npm run flow:validate-json`

The CI `schema` job runs exactly these steps on every push to `main` and every pull request targeting it (`.github/workflows/ci.yml`), so a stale schema fails the gate. All four CI jobs (`schema`, `quality`, `build`, `test`) must be green on `main` before triggering a release.

### Trigger the release

1. Merge the release PRs to `main` and confirm CI is green.
2. In GitHub, run the **Release** workflow (Actions → Release → Run workflow) and pick the bump type: `patch`, `minor`, or `major`.
3. The workflow then (`.github/workflows/release.yml`):
   - bumps the version in the root and all workspace `package.json` files;
   - generates `CHANGELOG.md` from commits since the last tag (git-cliff);
   - commits `chore: release vX.Y.Z`, tags it `vX.Y.Z`, and pushes both to `main`;
   - creates a GitHub release with the changelog as the body;
   - builds (`npm run build`) and publishes `@feature-forge/cli` to npm.

### Rebuild before consumers run `forge:init`

Scaffolding templates (agents, flows, skills) are not shipped as source: `dist/` is git-ignored and produced by `npm run build`. tsup's `onSuccess` copies `src/agents/declarative-specs`, `src/flows` (test files excluded), `src/skills`, and the whole `scripts` dir into `dist/`, then copies the shared `forge-config.defaults.json` (from `@feature-forge/shared`) to `dist/scripts/forge-config.defaults.json` (`packages/cli/tsup.config.ts`).

`forge-setup.js` resolves these assets with `resolveAssetsDir`, which checks `<pkg>`, then `<pkg>/dist`, then `<pkg>/src` — so the published layout scaffolds from `<pkg>/dist/`, and an unbuilt source tree falls back to `<pkg>/src/` (`packages/cli/scripts/forge-setup.js`). Consumers' `forge:init` therefore scaffolds from the published `dist/` — a release that changed flows, specs, or skills must ship a freshly built `dist/`. The Release workflow builds before publishing, but never publish from a stale `dist/`.

The full "re-run `forge:init`" invariant for a flow/asset change is: edit the source (e.g. `FlowInstruction.ts`) → `npm run flow:generate-schema` → `npm run flow:validate-json` → `npm run build` so the new templates land in `dist/flows` → release → consumers re-run `forge:init` in their projects (scaffolding is non-destructive — only missing files are copied) and restart pi when prompted.

## Design decisions

Architecture Decision Records (ADRs) live in [docs/adr/](docs/adr/). Create or update an ADR when introducing new abstractions, changing public APIs, agent lifecycle, communication protocols, or extension architecture.
