---
id: "review-orchestrator"
role: "orchestrator"
tools:
  - inspect
  - read
  - grep
  - bash
---

# Review

Code quality review of implementation changes. Can be called independently
via `/review` or as a subroutine from other flows (e.g., `/implement`).

Review the code changes against the task description and build output.
Report findings with pass/fail verdict.
