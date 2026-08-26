import { Type } from "typebox";
import { Value } from "typebox/value";

import { logger } from "../logging";
import { WorkspaceError } from "./WorkspaceError";

/**
 * A single persisted worktree entry in the v1 registry file.
 *
 * `createdAt` is a serialized ISO-8601 string (as produced by
 * `Date.toISOString()`); parseability is validated by the codec rather
 * than encoded as a regex in the schema.
 */
export interface WorktreeRegistryEntry {
  path: string;
  createdAt: string;
  branch: string;
  sessionId?: string;
}

/**
 * Versioned envelope persisted to the worktree registry file.
 *
 * `version` pins the on-disk contract: a future format bump must either
 * extend this schema or introduce a new literal version.
 */
export interface WorktreeRegistryFile {
  version: 1;
  worktrees: WorktreeRegistryEntry[];
}

const WorktreeRegistryEntrySchema = Type.Object({
  path: Type.String({ minLength: 1 }),
  createdAt: Type.String(),
  branch: Type.String({ minLength: 1 }),
  sessionId: Type.Optional(Type.String({ minLength: 1 })),
});

const WorktreeRegistryFileSchema = Type.Object({
  version: Type.Literal(1),
  worktrees: Type.Array(WorktreeRegistryEntrySchema),
});

function isParseableDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/**
 * Encode/decode the worktree registry file (`.forge/worktrees.json`).
 *
 * Pure, state-free, static-only utility class (ADR 0017). All validation
 * lives here so {@link WorktreeRegistry} only deals with file I/O and
 * in-memory state.
 *
 * Format handling:
 * - **v1 envelope** - `{ version: 1, worktrees: [...] }`. `parse` is
 *   strict: any schema violation (including an unparseable `createdAt`)
 *   throws {@link WorkspaceError} with per-field details, mirroring the
 *   `FlowValidation` error format.
 * - **v0 legacy** - a bare JSON array predating the versioned envelope.
 *   `parse` wraps it into the v1 envelope and drops entries that fail
 *   validation, logging a warning per dropped entry.
 */
export class WorktreeRegistryCodec {
  /** Static utility class - not instantiable. */
  private constructor() {}

  /**
   * Parse and validate the raw file contents.
   *
   * @throws {@link WorkspaceError} when the raw input is not valid JSON,
   *   is not a v1 envelope (or legacy array), or fails schema/date
   *   validation.
   */
  static parse(raw: string): WorktreeRegistryFile {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new WorkspaceError(
        `Failed to parse worktree registry JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause instanceof Error ? cause : undefined,
      );
    }

    // v0 legacy format - a bare array predating the versioned envelope.
    if (Array.isArray(parsed)) {
      return WorktreeRegistryCodec.migrateLegacy(parsed);
    }

    if (!Value.Check(WorktreeRegistryFileSchema, parsed)) {
      throw WorktreeRegistryCodec.invalidFile(parsed);
    }

    const file = parsed;
    const invalidDates = file.worktrees
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !isParseableDate(entry.createdAt));
    if (invalidDates.length > 0) {
      const details = invalidDates.map(
        ({ entry, index }) =>
          `  - /worktrees/${index}/createdAt: not a parseable date-time string (${entry.createdAt})`,
      );
      throw new WorkspaceError(`Invalid worktree registry file:\n${details.join("\n")}`);
    }

    return file;
  }

  /**
   * Serialize entries into the v1 envelope format.
   *
   * Validation mirrors {@link parse}: an entry that would fail parse-time
   * validation (schema violation or unparseable `createdAt`) is rejected
   * here, so the file written by `serialize` is always loadable.
   *
   * @throws {@link WorkspaceError} when any entry fails validation.
   */
  static serialize(entries: WorktreeRegistryEntry[]): string {
    const invalid = entries
      .map((entry, index) => ({
        issues: WorktreeRegistryCodec.entryIssues(entry, `/worktrees/${index}`),
      }))
      .filter(({ issues }) => issues.length > 0);
    if (invalid.length > 0) {
      const details = invalid
        .map(({ issues }) => issues.map((issue) => `  - ${issue}`).join("\n"))
        .join("\n");
      throw new WorkspaceError(`Cannot serialize worktree registry file:\n${details}`);
    }
    const file: WorktreeRegistryFile = { version: 1, worktrees: entries };
    return JSON.stringify(file, null, 2);
  }

  /**
   * Wrap a v0 bare-array file into the v1 envelope, dropping entries that
   * fail validation (with a warning per dropped entry).
   */
  private static migrateLegacy(entries: unknown[]): WorktreeRegistryFile {
    const worktrees: WorktreeRegistryEntry[] = [];
    for (const entry of entries) {
      if (!WorktreeRegistryCodec.isValidEntry(entry)) {
        logger.warn("Dropping invalid worktree registry entry during v0 migration", {
          entry,
          reasons: WorktreeRegistryCodec.entryIssues(entry, ""),
        });
        continue;
      }
      worktrees.push(entry); // narrowed by isValidEntry
    }
    return { version: 1, worktrees };
  }

  /**
   * Validate a single entry, returning human-readable issue strings.
   *
   * `pathPrefix` is prepended to each issue (empty for migration warnings,
   * `/worktrees/<index>` for envelope positions). Returns an empty array
   * when the entry is valid.
   */
  private static entryIssues(entry: unknown, pathPrefix: string): string[] {
    if (!Value.Check(WorktreeRegistryEntrySchema, entry)) {
      return [...Value.Errors(WorktreeRegistryEntrySchema, entry)].map(
        (e) => `${pathPrefix}${e.instancePath}: ${e.message}`,
      );
    }
    if (!isParseableDate(entry.createdAt)) {
      const where = pathPrefix === "" ? "createdAt" : `${pathPrefix}/createdAt`;
      return [`${where}: not a parseable date-time string`];
    }
    return [];
  }

  /**
   * Type guard for a fully valid entry (schema-conformant and with a
   * parseable `createdAt`), so callers can push the narrowed entry
   * without a cast.
   */
  private static isValidEntry(entry: unknown): entry is WorktreeRegistryEntry {
    return Value.Check(WorktreeRegistryEntrySchema, entry) && isParseableDate(entry.createdAt);
  }

  /**
   * Build a {@link WorkspaceError} describing schema validation failures,
   * mirroring the `FlowValidation` error format.
   */
  private static invalidFile(parsed: unknown): WorkspaceError {
    const details = [...Value.Errors(WorktreeRegistryFileSchema, parsed)].map(
      (e) => `  - ${e.instancePath}: ${e.message}`,
    );
    return new WorkspaceError(`Invalid worktree registry file:\n${details.join("\n")}`);
  }
}
