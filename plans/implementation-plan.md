# Implementation Plan — Feature Forge Agent Orchestration

Source: [deep-research-report.md](./deep-research-report.md)

## Current Project State

**Clean restart.** No existing code beyond a bare extension shell. No flows defined yet.

## Goal

Define implementation-agnostic **interface abstractions** (ports) that make it easy to create and handle orchestrators, agents, and subagents with optional worktree isolation. Concrete implementations (the "adapters") must be swappable without changing orchestration logic.

## Approach

A **ports-and-adapters** style: interfaces first, no default implementations baked in. We define the contracts, then layer implementations on top as needed.

### Tentative Abstraction Boundaries

| Abstraction         | Role                                                           | Swappable implementations (future)                 |
| ------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| `AgentSpec`         | Declarative spec: role, prompt, tools, model, workspace config | — (data structure)                                 |
| `WorkspaceProvider` | Create/clean up isolated working directories                   | worktree, clone, tmp dir, Docker volume            |
| `AgentRuntime`      | Launch and manage an agent process                             | local spawn, tmux pane, Docker container, SSH      |
| `AgentBus`          | Send/request/stream messages with correlation IDs              | in-process EventEmitter, stdout JSONL, Redis, NATS |
| `AgentHandle`       | Client handle to a running agent (send tasks, collect results) | — (depends on Runtime + Bus)                       |
| `Orchestrator`      | Lifecycle: compose agents, delegate, collect results           | simple sequential, DAG, supervisor‑subagent        |

### Design Principles

- All abstractions are **TypeScript interfaces/types/abstract classes only** — no concrete classes unless required for composition
- Each abstraction lives in its own module with a clear boundary
- Cross-cutting concerns (logging, tracing) are composable via wrappers/decorators, not hard-coded
- AgentSpec drives what workspace type, runtime, and bus an agent gets — orchestration logic stays generic

## Session Log

- **2026-06-21:** Clean restart. Goal shifted from "implement AgentSpec + Schemas" to "define interface abstractions first." Ports-and-adapters approach.
