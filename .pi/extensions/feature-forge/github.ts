import { execSync } from "node:child_process";
import { findDiscoverIssueUrl } from "./state";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/**
 * Expand a bare issue number to a full GitHub URL using the origin remote.
 * Returns the original ref unchanged if it's already a URL or can't be expanded.
 */
export function expandBareIssueNumber(ref: string): string {
  if (!/^\d+$/.test(ref)) return ref;

  try {
    const remote = execSync("git remote get-url origin", {
      encoding: "utf-8",
    }).trim();
    const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) {
      return `https://github.com/${match[1]}/issues/${ref}`;
    }
  } catch {
    // Leave as-is
  }
  return ref;
}

/**
 * Resolve an issue reference from command args, falling back to /discover state.
 * Returns the issue URL/ref, or undefined if nothing found.
 */
export function resolveIssueRef(
  args: string | undefined,
  entries: SessionEntry[],
): string | undefined {
  if (args && args.trim()) {
    return expandBareIssueNumber(args.trim());
  }
  return findDiscoverIssueUrl(entries);
}
