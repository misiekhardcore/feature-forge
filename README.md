# Feature Forge

Autonomous software engineering platform for [pi](https://github.com/earendil-works/pi-coding-agent), taking ideas from discovery through implementation with structured planning, ADR-driven design, and multi-agent orchestration.

## Install

```bash
pi install npm:@misiekhardcore/feature-forge
```

## Initialize a project

Invoke it from inside any git repository:

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
  "logRetentionDays": 7,
  "logMaxBytes": 10485760,
  "logMaxFiles": 5,
  "workspaceProvider": "git-worktree",
  "worktreeSymlinks": ["node_modules", ".env"],
  "specDirectories": { "flows": [], "agents": [] }
}
```

`logRetentionDays` sets how many days session log files are retained before startup pruning removes them (use 0 to disable pruning).

`logMaxBytes` (default 10 MB) is the size cap for one active log or journal segment: once it is exceeded, the next write rolls to a new numeric segment (`.1`, `.2`, ...). `logMaxFiles` (default 5) bounds how many segments are kept per process (session logs) or per agent (agent journals), evicting the oldest segments first, so disk usage stays hard-bounded regardless of write volume. Both knobs apply to session logs and agent journals alike.

Environment variables take precedence over config values: `FORGE_LOG_LEVEL`, `FORGE_LOG_DIR`, `FORGE_WORKTREE_SYMLINKS`, `FORGE_DEV`.

## Packages

The monorepo is layered strictly one-directionally: `core <- cli <- debug`.

| Package                | Role                                                                                                                                                                                | Publishes   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `@feature-forge/core`  | Engine and platform: agents, flows, executors, routines, IPC, workspace, config, logging, commands, registries, tool bases, skills, flow definitions. Source-only, ships no pi-tui. | no (source) |
| `@feature-forge/cli`   | pi extension and TUI display: composition root, cli-owned commands and tools (incl. `RoutineTool`), folded TUI views and progress.                                                  | yes (tsup)  |
| `@feature-forge/debug` | Dev-only test scenarios and commands; consumes cli-shaped components through dependency interfaces.                                                                                 | no (source) |

`core` and `debug` are pulled in as source through the npm workspace
(`main: ./src/index.ts`), while only `cli` builds with tsup and publishes the pi
extension bundle. The layering rules are recorded in
[ADR 0020](docs/adr/0020-package-layering-core-cli-debug.md).

Import `core` only via its package exports: either the root barrel
(`@feature-forge/core`, the full public API) or a public subpath
(`@feature-forge/core/workspace`, `@feature-forge/core/test-utils`, ...).
Deep imports into `/src/` are not part of the public surface.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, repository structure, pull request guidelines, and release process. The codebase follows an object-oriented style: modules expose classes, using instance classes for stateful logic and static-only utility classes (per [ADR 0017](docs/adr/0017-static-utility-classes.md)) for stateless helpers.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE)
