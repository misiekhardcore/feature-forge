import { WorkspaceProvider } from "./WorkspaceProvider";

/**
 * Registry mapping provider identifiers to {@link WorkspaceProvider} instances.
 *
 * A composition mechanism — resolves implementations by name, owns no business
 * logic, and does not create concrete dependencies internally.
 *
 * Built-in providers register at extension init:
 *
 * ```typescript
 * const registry = new WorkspaceProviderRegistry()
 *   .register("git-worktree", new GitWorktreeProvider(repoRoot))
 *   .register("current-dir", new CurrentDirProvider());
 * ```
 */
export class WorkspaceProviderRegistry {
  private readonly providers = new Map<string, WorkspaceProvider>();

  register(name: string, provider: WorkspaceProvider): this {
    if (this.providers.has(name)) {
      throw new Error(`Workspace provider already registered: ${name}`);
    }
    this.providers.set(name, provider);
    return this;
  }

  get(name: string): WorkspaceProvider | undefined {
    return this.providers.get(name);
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  names(): ReadonlySet<string> {
    return new Set(this.providers.keys());
  }
}
