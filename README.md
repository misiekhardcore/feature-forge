# Feature Forge

Autonomous software engineering platform for [pi](https://github.com/earendil-works/pi-coding-agent) — takes ideas from discovery through implementation, driven by structured planning, ADR-driven design, and multi-agent orchestration.

## Install

```bash
pi install npm:@misiekhardcore/feature-forge
```

## Initialize a project

Run inside any git repository:

```
/forge:init
```

Or non-interactively:

```bash
npx @misiekhardcore/feature-forge init --yes
```

This scaffolds `.forge/` directories, a default `.forge/config.json`, and `.gitignore` entries.

## Commands

| Command             | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `/forge:research`   | Research a topic with web search and structured findings |
| `/forge:implement`  | Run the full build → review → verify loop                |
| `/agent:spawn`      | Spawn a sub-agent for parallel work                      |
| `/agent:list`       | List active agents                                       |
| `/agent:destroy`    | Destroy an agent                                         |
| `/worktree:list`    | List active worktrees                                    |
| `/worktree:destroy` | Destroy a worktree                                       |
| `/worktree:prune`   | Prune stale worktrees                                    |
| `/forge:init`       | Initialize project scaffolding                           |

## Configuration

Feature Forge looks for `forge.config.json` (or `.forge/config.json`) in your project root. Defaults:

```json
{
  "logLevel": "info",
  "workspaceProvider": "git-worktree",
  "worktreeSymlinks": ["node_modules", ".env"],
  "specDirectories": { "flows": [], "agents": [] }
}
```

Environment variables override config: `FORGE_LOG_LEVEL`, `FORGE_LOG_DIR`, `FORGE_WORKTREE_SYMLINKS`, `FORGE_DEV`.

## Packages

The monorepo is layered strictly one-directionally: `core <- cli <- debug`.

| Package                | Role                                                                                                                                                                        | Publishes   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `@feature-forge/core`  | Engine + platform: agents, flows, executors, routines, IPC, workspace, config, logging, commands, registries, tool bases, skills, flow definitions. Source-only, no pi-tui. | no (source) |
| `@feature-forge/cli`   | pi extension + TUI display: composition root, cli-owned commands/tools (incl. `RoutineTool`), folded TUI views/progress.                                                    | yes (tsup)  |
| `@feature-forge/debug` | Dev-only test scenarios and commands; accepts cli-shaped components via dependency interfaces.                                                                              | no (source) |

`core` and `debug` are consumed as source via the npm workspace
(`main: ./src/index.ts`); only `cli` builds with tsup and publishes the pi
extension bundle. See [ADR 0020](docs/adr/0020-package-layering-core-cli-debug.md)
for the layering decisions.

Import `core` through its package exports: the root barrel
(`@feature-forge/core` - full public API) or a public subpath
(`@feature-forge/core/workspace`, `@feature-forge/core/test-utils`, ...).
`/src/` deep imports are not part of the public surface.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, repository structure, pull request guidelines, and release process. The codebase is object-oriented: modules expose classes (instance classes for stateful logic, static-only utility classes per [ADR 0017](docs/adr/0017-static-utility-classes.md) for stateless helpers).

## License

[PolyForm Noncommercial License 1.0.0](LICENSE)
