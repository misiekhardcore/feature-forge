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
npx @misiekhardcore/feature-forge init --yes           # project scope
npx @misiekhardcore/feature-forge init --yes --global  # global scope
```

Choose a scope: **project** (`.forge/` inside the current repo) or **global** (`~/.forge`, shared across projects). Initialization is additive and idempotent - it copies the packaged agents, flows, and skills plus a default `.forge/config.json` into the chosen home, never overwriting existing files, and appends `.gitignore` entries for runtime artifacts.

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

Feature Forge reads two optional config files and merges them over the packaged defaults:

- `<project>/.forge/config.json` - project scope (wins on conflict)
- `~/.forge/config.json` - global scope (shared across projects)

Project keys override global keys, which override the built-in defaults; a missing file is simply skipped. The override is per top-level key: setting one key inside a nested section (e.g. `display`, `defaultAgent`, `agents`) in the project file replaces the global file's entire section - nothing inside a section is deep-merged across files (see ADR 0028). `FORGE_*` environment variables override everything, including both files. Defaults (merged under anything you set; representative excerpt):

```json
{
  "logLevel": "info",
  "workspaceProvider": "git-worktree",
  "worktreeSymlinks": [],
  "specDirectories": { "flows": [], "agents": [] }
}
```

The complete built-in default set is defined in `packages/core/src/config/forge-config.defaults.json` in this repo.

Asset homes (agents, flows, skills) layer the same way: `<project>/.forge`, then `~/.forge`, then the packaged defaults shipped with the extension. Discovery is per item and nearest wins, so per-project customizations beat shared global copies.

Environment variables override config: `FORGE_LOG_LEVEL`, `FORGE_LOG_DIR`, `FORGE_WORKTREE_SYMLINKS`, `FORGE_DEV`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, repository structure, pull request guidelines, and release process.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE)
