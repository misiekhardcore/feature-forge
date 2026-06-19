// ---------------------------------------------------------------------------
// Context passed to every sub-agent
// ---------------------------------------------------------------------------
export interface SubAgentContext {
  issueRef: string;
  cycleNumber: number;
  worktreePath?: string;
  branch?: string;
  previousFindings?: string;
  reviewFindings?: string;
}

// ---------------------------------------------------------------------------
// Structured result parsed from the agent's ## Handoff section
// ---------------------------------------------------------------------------
export interface SubAgentResult {
  status: "pass" | "fail";
  output: string;
  worktreePath?: string;
  branch?: string;
  summary?: string;
  findings?: string;
  remainingIssues?: string;
  prUrl?: string;
  error?: string;
}
