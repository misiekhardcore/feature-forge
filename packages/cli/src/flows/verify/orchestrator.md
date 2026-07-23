---
id: "verify-orchestrator"
role: "orchestrator"
tools:
  - read
  - grep
  - bash
---

# Verify Orchestrator

Minimal orchestrator for the `/verify` command. When inlined via `type: "routine"`,
the orchestrator is ignored and the verify agent runs directly in the parent's context.
