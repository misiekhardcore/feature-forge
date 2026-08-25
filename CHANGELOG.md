# Changelog

All notable changes to this project are documented in this file.

## [0.4.0] - 2026-08-25

### CI/CD

- Run e2e suite in its own job (spawns real pi CLI)

### Chores

- Remove dead \_\_dirname polyfill from cli extension factory
- Release v0.4.0

### Refactoring

- Package restructure — core/cli/debug split (fold tui+shared into core, DisplayProjection 2a) (#233)
