# Changelog

All notable changes to this project are documented in this file.

## [0.1.5] - 2026-07-30

### Bug Fixes

- Remove dirty-tree block and fix wt add path handling (#44)
- Address all code review findings — wire executors, implement stubs, add tests
- RoutineTool name — use routineName directly, not flowName:routineName
- Missing import
- Capture wt output from stderr when stdout is empty
- **agent-step:** Adapt workingDir wiring to renamed AgentSpecification fields
- **workspace:** Worktree base-ref, output-parsing validation, open_pr commit hard-fail (#58)
- **workspace:** Make worktree branch names unique across invocations
- **workspace:** Register flow-created worktrees in persistent registry
- **orchestrator:** Make onProgress required, add GitStepExecutor events
- Use ctx.ui.notify in WorktreeListCommand for immediate visibility
- Update test assertions for 🗑️ emoji notifications in destroy commands
- Update vitest configuration to exclude additional directories from tests
- Pass AbortSignal explicitly at all executeStep and executeTask call sites (#65)
- Remove duplicate params definition in flow.json
- Use short UUID instead of timestamp for workspace IDs, remove redundant suffix from GitWorktreeProvider (#84)
- Make $schema required in both TypeBox and JSON Schema (#79)
- Make add-and-commit idempotent when branch already has commits (#88)
- Update .gitignore to include .turbo
- Add PI extensions configuration for CLI package
- **implement:** Add AC checklist gating to orchestrator workflow
- Resolve template placeholders in key and value for session instructions (#99)
- Propagate abort signals for immediate Esc interruption in build loop (#101)
- Show ✗ icon and agent summary when passed: false + universal AgentOutput (#103)
- AgentViewerOverlay is dead -- 11 bugs preventing agent event rendering (#108)
- Add .env to .gitignore to prevent environment file tracking
- Update flow schema URL references to correct path
- Prevent orphaned collectEvents promise from crashing pi process (#126)
- Rounds field always ≥1, blocking cleanup/workspace display in result rows (#130)
- LoopStepExecutor passes 0-indexed iteration to withIteration, rounds off by one (#131)
- OOM from unbounded agent event accumulation in PiSubprocessAgent + AgentViewerOverlay (#129)
- Agent detail overlay layout, data loading, and [object Object] rendering bugs (#135)
- Correct environment variable check in registerDevTestCommands function
- Pass routineDef from RoutineTool to RoutineExecutor so builtin tools resolve correctly (#142)
- Show param key/value in set_flow_param result suffix (#150)
- Prevent TUI crash from multi-line raw output in routine result suffix (#149)
- Add params to generated flow-schema.json (#157)
- Reliable workspace/branch cleanup — branch deletion, exit cleanup, reconciliation, prune (#176)
- Parse colon syntax in toolListToRestrictions and enforce restrictions in SessionAgent.mount() (#178)
- Add rework flow and branch cleanup for PR rework (#179)
- Commit pending session-scoped workspace tracking changes from merge
- Update tests for WorkspaceManager-based session tracking refactor (#182)
- Add metadata and README to published CLI package

### CI/CD

- Add schema drift check and parallelize pipeline jobs (#163)

### Chores

- Initialize repository with README and LICENSE files
- Establish project foundation (dev tooling, CI/CD, docs) (#35)
- Add tsconfig.json for IDE support (#36)
- Add lint-staged + husky pre-commit hook (#37)
- Fresh start
- Translate input component text to English
- Fix timeout issues
- Add wt config
- Remove accidental workspace debris from commit
- Remaining renames
- Gitignore .claude directory
- Remaining renames
- Fix ts unknown casting
- Review suggestions
- Add read tools to implement orchestrator
- Update AGENTSmd
- Update documentation
- Ignore schema from formatting
- Bump CLI version to 0.1.4 for metadata fix republish
- Bump CLI version to 0.1.5

### Documentation

- ADR 0006 — git and shell instruction schemas for PR-able routines
- Update AGENTS.md, CONTRIBUTING.md, and README.md to reflect monorepo structure (#132)
- Enhance orchestrator workflow documentation with detailed plan format requirements
- Update README for end-user journey, add npm metadata, bump to 0.1.3

### Features

- /discover command — interactive feature discovery → GitHub issue (#33)
- Add /define command with background research in separate pi process (#34)
- Add /implement command with sub-agent orchestration (coordinator + build/review/verify/PR) (#38)
- Add deep research report on agent orchestration architecture
- Implement agent architecture with core classes for agent management and governance
- Implement agent orchestration framework with TypeScript interfaces
- Enhance agent functionality and specifications
- Restructure agent specifications and commands
- Add LLM-to-Spawn-Subagents research and implementation strategies
- **tests:** Add comprehensive tests
- Add initial documentation for code validation, coverage, project structure, and coding conventions
- Enhance research agent specifications and templates with context handling
- **ipc:** Implement IPC error handling and message types
- Enhance ParentSocketServer to integrate with ExtensionAPI and manage agent statuses
- **workspace:** Implement GitWorktreeProvider for isolated workspaces
- Introduce SpecRegistry for agent specifications management
- Expand architecture documentation with agent isolation, process boundaries, and extensibility guidelines
- **logging:** Implement ConsoleLogger and FileLogger for improved logging functionality
- Implement flow orchestrator with validation and loading capabilities
- Add comprehensive implementation plans for flow architecture
- Enhance task execution with optional timeout and image support
- U1-U5 routine-based flow schema — core contract rewrite
- U6-U8 routine execution, tool registration, and orchestrator wiring
- **git-step:** Configurable commit message and push output capture
- **agent-step:** Wire workingDir field into agent spawn
- **workspace:** Add unique path suffix to worktree directories
- **orchestrator:** Stream per-step progress from routine runtime
- Dual emission via pi EventBus
- Dual emission via pi EventBus
- Make onProgress parameter required in RoutineExecutor.run
- Integrate makeMockEventBus into RoutineExecutor and related tests
- Enhance destruction notifications with emoji for Agent and Worktree commands
- Add AbortSignal support for routine cancellation
- Add AbortSignal support across IPC, tools, agents, and executors
- Add live TUI progress panel for routine execution (#67)
- Automated changes (#76)
- **orchestrator:** Parallel failure_mode + FlowSession flow-global store (#51) (#71)
- Enable multi-call run_build_loop with shared worktree (#89)
- Enhance agent specifications and testing tools for improved quality assurance (#96)
- Migrate to Turborepo monorepo (CLI + shared + web placeholder) (#94)
- /flow:exit command to restore default mode after flow exit (#105)
- Real-time agent viewer overlay with streaming conversation (#95)
- Granular bash allowlist via bash:<pattern> parsing and child-side spec resolution (#104)
- Symlink provisioning for workspace providers (#110)
- Render agent viewer detail with pi's conversation components (#111) (#112)
- Decouple DisplayContribution from ProgressRenderer via handler registry (#116) (#118)
- Development test extension for AgentViewerOverlay TUI rendering (#133)
- Remove deep research report and implementation plan documents
- Improve agents viewer rendering
- Align ConversationRenderer with pi's AgentMessage-based rendering (#144)
- Enrich agent specs with skill files for build, review, and verify (#147)
- Add test-loop-routine dev command for widget/overlay alignment testing (#155)
- Allow create_workspace to reuse an existing branch (#160)
- Extract TUI rendering primitives to @feature-forge/tui package (#162)
- Add pre-push sync gate (fetch/rebase/revalidate) to open_pr routine (#158)
- Separate typecheck and build configurations (#164)
- Flow composition v2 — inline flattening of cross-flow routine references (#159)
- Model presets — smart/medium/dumb aliases in config and flow JSON (#167)
- **release:** Add npm publish steps after GitHub release
- Bundle build, install script, and forge:init command for npm release

### Performance

- Optimize agent viewer overlay rendering (#154)

### Refactoring

- Simplify PiSubprocessAgentFactory by removing unused options and paths
- Replace 'identifier' with 'id' in agent specifications and related components
- Remove unused supervisor parameter from command constructors and update tests
- Update ToolRenderer to return Text instances instead of Box
- Adopt patterns from PR #42 review
- Separate system prompt from user prompt, decouple orchestrator from command
- Unify IPC spawn_agent to single unambiguous mode
- Unify registration patterns across all registries
- **agents:** Unify Agent hierarchy (subprocess vs in-session)
- **agents:** Promote specification to Agent base; drop Mounted status
- **loaders:** Unify spec loading; orchestrator persona via shared SpecLoader
- Split spec loading between SpecLoader and SpecManager
- Use specmanager to instantiate agents in ipc
- **workspace:** Use path field for workspace registration
- Improve type safety and error handling across multiple files
- Migrate onProgress callback to eventBus
- Replace ConversationRenderer state machine with Container-based component tree (#141)

### Testing

- Add registerInstance duplicate test, remove broken git/shell exec tests
- Add AgentStepExecutor and OrchestratorCommand tests, extend makeMockPi
- Add fillTemplate(values=undefined) test, bring branches to 89.27%
