---
id: "verify-orchestrator"
role: "orchestrator"
tools:
  - check
  - read
  - grep
  - bash
---

# Verify

Verification of acceptance criteria for code changes. Can be called
independently via `/verify` or as a subroutine from other flows
(e.g., `/implement`).

Verify the implementation against the acceptance criteria and report
pass/fail per criterion.
