import type { CustomEntry, SessionEntry } from "@earendil-works/pi-coding-agent";

export interface PipelineState {
  issueUrl?: string;
  issueNumber?: number;
  prUrl?: string;
  prNumber?: number;
}

const PIPELINE_ISSUE_TYPE = "pipeline-issue";

/** Extract the pipeline issue URL from session entries (shared across phases). */
export function findPipelineIssueUrl(entries: SessionEntry[]): string | undefined {
  const entry = entries
    .filter(
      (e): e is CustomEntry<PipelineState> =>
        e.type === "custom" && e.customType === PIPELINE_ISSUE_TYPE,
    )
    .pop();
  return entry?.data?.issueUrl;
}
