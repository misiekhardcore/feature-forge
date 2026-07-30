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

This scaffolds `.forge/` directories, a default `forge.config.json`, and `.gitignore` entries.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, repository structure, pull request guidelines, and release process.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE)
