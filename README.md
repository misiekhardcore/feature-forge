# Feature Forge

[![CI](https://github.com/misiekhardcore/feature-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/misiekhardcore/feature-forge/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue.svg)](LICENSE)

Autonomous software engineering platform — from idea to production-ready implementation, driven by structured discovery, ADR-driven design, and multi-agent orchestration.

## Core capabilities

- **Interactive ideation** and requirements discovery
- **Architecture and design decisions** (ADR-driven)
- **Autonomous feature planning and implementation**
- **Build, test, and validation loops**
- **Project, design, and failure memory**
- **Model routing** (Opus, Sonnet, Haiku)
- **Dynamic task decomposition** and agent allocation
- **Continuous learning** from reviews and implementation failures

## Repository structure

This is a Turborepo monorepo managed with npm workspaces:

| Package                        | Location                  | Description                                                  |
| ------------------------------ | ------------------------- | ------------------------------------------------------------ |
| `@feature-forge/cli`           | `packages/cli/`           | Main pi extension — orchestrator, step executors, IPC agents |
| `@feature-forge/shared`        | `packages/shared/`        | Shared base types and abstractions                           |
| `@feature-forge/eslint-config` | `packages/eslint-config/` | Shared ESLint configuration                                  |
| `@feature-forge/web`           | `packages/web/`           | Web UI (TBD)                                                 |

## Installation

```bash
git clone https://github.com/misiekhardcore/feature-forge.git
cd feature-forge
npm install
```

## Usage

Feature Forge runs as a [pi](https://github.com/earendil-works/pi-coding-agent) extension. Add it to your pi configuration to enable the feature development pipeline commands.

## Development

```bash
npm test            # Run tests (vitest, all packages)
npm run check       # Run all checks (lint + format + test)
npm run typecheck   # Full TypeScript type safety check
npm run lint        # Check code style (turbo, all packages)
npm run lint:fix    # Auto-fix lint issues (turbo, all packages)
npm run format      # Check formatting (turbo, all packages)
npm run format:fix  # Auto-fix formatting (turbo, all packages)
npm run fix         # Combined: lint:fix + format:fix — run before pushing
npm run changelog   # Generate CHANGELOG.md
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full development setup, and [AGENTS.md](AGENTS.md) for coding conventions, operational patterns, and project structure.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE)
