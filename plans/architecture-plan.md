# Feature Forge Architecture Plan

Feature Forge is an orchestration layer for the Pi coding agent, designed to manage a fleet of specialized subagents that can operate in parallel, in isolated workspaces, and with dedicated observability.

## 1. Core Architecture Principles

- **OOP Abstraction**: Every major component (Commands, Tools, Agents) is defined by a base abstract class to decouple the "what" (contract) from the "how" (implementation).
- **Separation of Concerns**:
  - **Commands**: UI-driven triggers that initiate workflows.
  - **Tools**: Capabilities provided to agents for task execution.
  - **Agents**: Independent execution units with specific roles.
  - **Supervisor**: The orchestrator managing the lifecycle of the agent fleet.
- **Observability vs. Orchestration**: Orchestration happens via structured APIs and state management. Observability (e.g., Tmux panes) is an adapter layer that visualizes the orchestration, not the primary driver of it.
- **Declarative Agents**: Agents are defined by `AgentSpecification` objects, allowing roles and capabilities to be swapped or extended without changing the runtime logic.

---

## 2. Component Model

### 2.1 Command Layer

Commands are the entry points for the user. They are decoupled from the Pi extension API to improve testability and maintainability.

- **`Command` (Abstract)**: Base class defining `name`, `description`, and `execute()`.
- **Concrete Commands**: Individual classes (e.g., `ResearchCommand`, `AgentListCommand`) encapsulating specific logic.
- **Command Registry**: A factory pattern in `src/commands/index.ts` that instantiates and provides all available commands to the bootstrap layer.

### 2.2 Tool Layer

Tools are the capabilities exposed to agents.

- **`Tool` (Abstract)**: Base class defining the contract for tool execution.
- **Tool Registry**: A centralized collection of tools that can be assigned to agents based on their `AgentSpecification`.

### 2.3 Agent Layer

The agent system is built as a pipeline: `Specification` $\to$ `Factory` $\to$ `Agent` $\to$ `Supervisor`.

#### Agent Specification (`AgentSpecification`)

A declarative definition of an agent's role, system prompt, and capabilities. It describes _what_ the agent is, not _how_ it runs.

#### Agent Factory (`AgentFactory`)

Handles the concrete instantiation of an agent. This is where the "runtime" is decided (e.g., `PiSubprocessAgentFactory` for local subprocesses). It manages workspace allocation and process spawning.

#### Agent (`Agent`)

A handle to a running agent instance. It manages the agent's state, task execution, and result delivery.

- **`deliverResult()`**: Each agent type controls how its success/failure is presented to the user.

#### Agent Supervisor (`AgentSupervisor`)

The central authority for the agent fleet.

- **Lifecycle Management**: Spawning, tracking, and destroying agents.
- **Execution Entry Point**: `runAgent()` provides a simplified fire-and-forget mechanism for task delegation.

---

## 3. Current Technical Stack

- **Language**: TypeScript
- **Runtime**: Node.js (via Pi Extension API)
- **State Management**: In-memory supervisor (currently)
- **Agent Runtime**: Subprocess-based execution

---

## 4. Future Evolutions (Roadmap)

### 4.1 Workspace Isolation

- **Worktree Integration**: Moving from a shared directory to dedicated Git worktrees per agent to prevent file conflicts and allow parallel branching.

### 4.2 Observability Adapters

- **Tmux Integration**: Implementing a `TmuxAdapter` that automatically creates and manages tmux panes for every spawned agent, allowing the user to monitor subagents in real-time without interfering with orchestration.

### 4.3 Communication Bus

- **Actor Model**: Transitioning from simple task-execution to a message-bus architecture where agents can send/receive structured messages, request help from other agents, and report status updates asynchronously.

### 4.4 Artifact Store

- **Structured Output**: Instead of agents returning raw strings, they will produce "Artifacts" (e.g., `PatchArtifact`, `ReportArtifact`) that the supervisor can validate and merge into the main project.
