---
id: "review-orchestrator"
role: "orchestrator"
tools:
  - read
  - grep
  - bash
---

# Review Orchestrator

Minimal orchestrator for the `/review` command. When inlined via `type: "routine"`,
the orchestrator is ignored and the review agent runs directly in the parent's context.
