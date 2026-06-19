import type { CustomEntry, SessionEntry } from "@earendil-works/pi-coding-agent";

export interface DiscoverState {
  issueUrl?: string;
  issueNumber?: number;
}

const DISCOVER_ISSUE_TYPE = "discover-issue";

/** Extract the discover-issue URL from session entries. */
export function findDiscoverIssueUrl(entries: SessionEntry[]): string | undefined {
  const entry = entries
    .filter(
      (e): e is CustomEntry<DiscoverState> =>
        e.type === "custom" && e.customType === DISCOVER_ISSUE_TYPE,
    )
    .pop();
  return entry?.data?.issueUrl;
}
