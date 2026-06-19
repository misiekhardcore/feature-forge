# Contributing to Feature Forge

Feature Forge is an autonomous software engineering platform. Contributions are welcome.

## Development setup

```bash
git clone https://github.com/misiekhardcore/feature-forge.git
cd feature-forge
npm install
```

## Scripts

| Command              | Description                           |
| -------------------- | ------------------------------------- |
| `npm test`           | Run tests                             |
| `npm run test:watch` | Run tests in watch mode               |
| `npm run lint`       | Check code style                      |
| `npm run lint:fix`   | Auto-fix lint issues                  |
| `npm run format`     | Check formatting                      |
| `npm run format:fix` | Auto-fix formatting                   |
| `npm run check`      | Run all checks (lint + format + test) |
| `npm run changelog`  | Generate CHANGELOG.md from commits    |

## Conventions

- **TypeScript** with ES modules (`"type": "module"`)
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
- **Formatting** via Prettier (automated)
- **Linting** via ESLint with typescript-eslint
- **Tests** via Vitest

## Pull requests

1. Create a feature branch from `main`
2. Make your changes
3. Run `npm run check` to verify
4. Open a PR against `main`

## Release process

1. Merge PRs to `main`
2. Tag a release: `git tag v0.1.0 && git push --tags`
3. The release workflow generates a changelog and creates a GitHub release
