**You:**

i am studying pi agent docs and there are two packages pi-agent-core and pi-coding-agent. is one build on top of the other?

* * *

**ChatGPT:**

Yes. From the architecture docs and package descriptions, **`pi-coding-agent` is built on top of `pi-agent-core`**. [![](https://www.google.com/s2/favicons?domain=https://agent-safehouse.dev&sz=128)agent-safehouse.dev+1](https://agent-safehouse.dev/docs/agent-investigations/pi?utm_source=chatgpt.com)

A useful way to think about it:

```
pi-ai
  ↓
pi-agent-core
  ↓
pi-coding-agent
```

### pi-agent-core

This is the **generic agent runtime/framework**. It provides:

* Conversation state management
* Tool-calling loops
* Streaming events
* Message handling
* Agent lifecycle management
* Steering/follow-up queues

It is intentionally application-agnostic—you can use it to build any kind of agent, not just a coding assistant. [![](https://www.google.com/s2/favicons?domain=https://pypi.org&sz=128)PyPI+2![](https://www.google.com/s2/favicons?domain=https://pt-act-pi-mono.mintlify.app&sz=128)pt-act-pi-mono.mintlify.app+2](https://pypi.org/project/pi-agent-core/?utm_source=chatgpt.com)

### pi-coding-agent

This is the **actual coding-agent application layer** that uses the core runtime and adds:

* File editing tools
* Bash execution
* Search/grep/find tools
* Session management
* Extensions
* TUI/CLI behavior
* Coding workflows

The monorepo explicitly lists `pi-agent-core` as the agent runtime package and `pi-coding-agent` as the coding-agent CLI built on top of it. [![](https://www.google.com/s2/favicons?domain=https://agent-safehouse.dev&sz=128)agent-safehouse.dev+1](https://agent-safehouse.dev/docs/agent-investigations/pi?utm_source=chatgpt.com)

### When would you use each?

* **Use `pi-agent-core`** if you're building your own custom agent system and want the orchestration layer without the coding-agent assumptions.
* **Use `pi-coding-agent`** if you want the full coding assistant experience or want to extend Pi's coding agent with custom tools/extensions.

If you're reading the Pi source code, I'd recommend understanding `pi-agent-core` first. Once the tool loop and event model make sense, the `pi-coding-agent` layer becomes much easier to follow because it's mostly adding coding-specific tools, sessions, and UX on top of the core runtime. [![](https://www.google.com/s2/favicons?domain=https://deepwiki.com&sz=128)DeepWiki](https://deepwiki.com/badlogic/pi-mono/3-%40mariozechnerpi-agent-core?utm_source=chatgpt.com)

* * *

**You:**

so, now I am planning to build an extension for pi to run agents in separate tmux panels and slso in separate worktrees if needed. I need a very abstract and extensible architecture. I need agents to be able to spawn other agents to delegate them tasks and get back results. I want separate tmux panes for each agent for good observability. We might want to define custom prompts, agent files, tools (depending on what is the recommended approach)

* * *

**ChatGPT:**

That sounds like a good fit for Pi's extension model, but I'd strongly recommend designing it as a **multi-agent orchestration layer above `pi-agent-core`**, not as a collection of hardcoded coding-agent hacks.

## Mental model

Think in terms of:

```
Supervisor Agent
│
├── Agent A (tmux pane, worktree A)
│
├── Agent B (tmux pane, worktree B)
│
│   └── Agent B1 (delegated sub-agent)
│
└── Agent C (tmux pane, same worktree or isolated)
```

Where every agent is:

```
Agent Process
+ Context
+ Workspace
+ Tools
+ Prompt
+ Communication Channel
```

The supervisor should not care whether an agent runs:

* in same process
* separate process
* separate tmux pane
* separate machine
* separate container

Those are implementation details.

* * *

# Core abstractions

I would define 5 core concepts.

## 1. AgentSpec

Declarative definition of an agent.

```TypeScript
interface AgentSpec {
  id: string;

  role: string;

  systemPrompt: string;

  workspace: WorkspaceSpec;

  tools: ToolSet;

  model: ModelConfig;

  parent?: string;
}
```

Examples:

```YAML
agent:
  id: frontend
  role: frontend-engineer

workspace:
  type: worktree

prompt: prompts/frontend.md

tools:
  - read_files
  - edit_files
  - run_tests
```

* * *

## 2. WorkspaceProvider

Abstract workspace isolation.

```TypeScript
interface WorkspaceProvider {
  create(): Promise<Workspace>;
  destroy(): Promise<void>;
}
```

Implementations:

### Current repo

```
.
```

### Git worktree

```
.worktrees/frontend
```

### Temporary clone

```
/tmp/pi-agent-123
```

### Future

```
docker
k8s
remote ssh
```

This abstraction will save you later.

* * *

## 3. AgentRuntime

How an agent executes.

```TypeScript
interface AgentRuntime {
  spawn(spec: AgentSpec): Promise<AgentHandle>;
}
```

Implementations:

### Local process

```
pi
```

### Tmux runtime

```
tmux split-window
```

### Docker runtime

```
docker run
```

### Remote runtime

```
ssh host
```

Again, keep tmux as an implementation detail.

* * *

## 4. Communication Bus

Most important abstraction.

Agents should not communicate via tmux.

Tmux is visualization only.

Use:

```TypeScript
interface AgentBus {
  send(message);
  request(message);
  stream(message);
}
```

Example:

```
Supervisor
   │
   ▼
Bus
   │
   ▼
Worker
```

Messages:

```TypeScript
delegate_task
task_result
status_update
artifact_created
agent_spawned
```

Think actor model.

* * *

## 5. Artifact Store

Agents should return artifacts, not chat.

```TypeScript
interface Artifact {
  id: string;
  type: string;
}
```

Examples:

```
patch
branch
report
design-doc
test-results
```

Instead of:

```
Agent B:
"I changed some files."
```

Return:

```JSON
{
  "type": "patch",
  "files": [...]
}
```

Supervisor can consume structured results.

* * *

# Agent spawning

I would expose a tool:

```
spawn_agent
```

Tool input:

```JSON
{
  "role": "frontend",
  "task": "Implement settings page"
}
```

Internally:

```
Current Agent
      │
      ▼
Supervisor
      │
      ▼
Create AgentSpec
      │
      ▼
WorkspaceProvider
      │
      ▼
AgentRuntime
      │
      ▼
New Agent
```

Returns:

```JSON
{
  "agentId": "agent-42"
}
```

Then:

```
await_agent(agent-42)
```

or

```
send_message(agent-42)
```

* * *

# Tmux architecture

I would NOT tie agents directly to panes.

Instead:

```
Agent
   │
   ▼
AgentRuntime
   │
   ▼
TmuxAdapter
```

```TypeScript
interface ObservabilityAdapter {
  attach(agent);
}
```

Implementation:

```
TmuxAdapter
```

creates

```
session: project

pane 1 supervisor
pane 2 frontend
pane 3 backend
pane 4 reviewer
```

Later you can swap to:

```
Web UI
Terminal UI
OpenTelemetry
```

without touching orchestration.

* * *

# Prompt architecture

Don't hardcode prompts.

Use profiles.

```YAML
agent:
  role: reviewer

prompt:
  file: prompts/reviewer.md
```

or

```YAML
extends: software-engineer

overrides:
  - focus on testing
```

Think inheritance.

```
base-agent
    │
    ├── frontend
    ├── backend
    ├── reviewer
    └── architect
```

* * *

# Tool architecture

Tools should also be profile-driven.

```YAML
tools:
  - read
  - edit
  - grep
```

Reviewer:

```YAML
tools:
  - read
  - grep
```

No edit permissions.

This becomes important when agents start spawning agents.

* * *

# What I'd build first

MVP:

```
Supervisor
    │
    ├── spawn_agent
    ├── await_agent
    └── list_agents
```

With:

```
WorkspaceProvider
  └── GitWorktreeProvider

Runtime
  └── TmuxRuntime
```

and agent communication through a simple JSON message bus.

After that, add:

```
reviewer agents
planner agents
parallel agents
recursive delegation
artifact passing
```

The key architectural decision is: **tmux should be observability, not orchestration**. The orchestration layer should think in terms of agents, workspaces, messages, and artifacts. Then tmux panes become just one visualization of that system, which keeps the design extensible when you eventually want web dashboards, Docker isolation, or remote workers.