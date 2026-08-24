# ADR 0018: Configurable pi CLI path for sub-agent spawning

**Date:** 2026-08-24
**Status:** Accepted

## Context

`PiSubprocessAgentFactory.buildRpcClient()` resolves the child pi CLI as:

```ts
cliPath: this.options.cliPath ?? join(getPackageDir(), "dist/cli.js");
```

`getPackageDir()` walks up from the `pi-coding-agent` module inside
feature-forge's own `node_modules`, so spawned sub-agents boot the pi copy
bundled with feature-forge, not the host session's pi. When that bundled copy
falls behind the pi version required by the user's global extension packages,
children crash at extension load (issue 234: pi-ai 0.79.10 lacking the
`/compat` entry required by `pi-mcp-adapter@2.27.0` and `agents-memo`).

Bumping feature-forge's pi devDependencies to match the host aligns children
with the host, but it does not cover installs that pin a different pi for
their own reasons. `PI_PACKAGE_DIR` already redirects `getPackageDir()`, but
it is process-global: setting it also redirects the hosting pi session's own
asset resolution (themes, docs, package.json), so it cannot be scoped to
child spawning.

## Decision

Add an optional `piCli` field to `ForgeConfigSchema`:

```jsonc
{
  "piCli": "/abs/path/to/pi/dist/cli.js",
}
```

- `ForgeConfig.getPiCli()` exposes the resolved value (`undefined` when
  unset).
- The extension entry threads it into `PiSubprocessAgentFactory` options as
  `cliPath`, so `buildRpcClient()` uses it instead of the bundled pi.
- Unset means the previous behavior: resolve the pi bundled with
  feature-forge via `getPackageDir()`.

Relative paths are not expanded — the value is passed to pi's `RpcClient`
verbatim, and documented as an absolute path.

## Consequences

- **Install-scoped pinning** — a forge.config can pin children to a specific
  pi (e.g. the host's global install) without upgrading feature-forge or
  touching `PI_PACKAGE_DIR`.
- **Backwards compatible** — omitting the field preserves the pre-existing
  resolution path exactly.
- **No env-var coupling** — the knob is config-scoped and reloadable via the
  existing SIGHUP config reload.
