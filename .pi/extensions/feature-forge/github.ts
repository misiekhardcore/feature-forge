import { execSync } from "node:child_process";

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

export function isGitHubIssueUrl(ref: string): RegExpMatchArray | null {
  return ref.match(/https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
}

export function isGitHubPrUrl(ref: string): RegExpMatchArray | null {
  return ref.match(/https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
}
