import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { InMemoryAgentSupervisor, SpecManager } from "../agents";
import { OrchestratorCommand } from "../commands/OrchestratorCommand";
import type { AgentModelConfig } from "../config";
import type { TypedEventBus } from "../event-bus";
import type { StepExecutorRegistry } from "../executors/StepExecutorRegistry";
import { logger } from "../logging";
import type { CommandRegistry } from "../registry/CommandRegistry";
import type { ToolRegistry } from "../registry/ToolRegistry";
import { RoutineExecutor } from "../routines/RoutineExecutor";
import type { Tool } from "../tools";
import type { WorkspaceManager } from "../workspace";
import type { ActiveFlowRegistry } from "./ActiveFlowRegistry";
import type { FlowDefinition, RoutineDefinition } from "./FlowInstruction";
import { discoverFlowDirectories, FlowLoader } from "./FlowLoader";
import { FlowStateStore } from "./FlowStateStore";

export type CreateRoutineTool = (
  flowName: string,
  routineDef: RoutineDefinition,
  routineExecutor: RoutineExecutor,
  supervisor: InMemoryAgentSupervisor,
) => Tool;

/**
 * Shared context threaded through flow registration: the pi extension
 * surface plus the registries and managers each discovered flow wires into.
 *
 * Passed as a single object so fields never get destructured and rebuilt
 * at every call boundary.
 */
export interface FlowRegistrarContext {
  pi: ExtensionAPI;
  cmdRegistry: CommandRegistry;
  toolRegistry: ToolRegistry;
  supervisor: InMemoryAgentSupervisor;
  specManager: SpecManager;
  workspaceManager: WorkspaceManager;
  flowDirs: readonly string[];
  knownProviders: ReadonlySet<string>;
  stepExecutorRegistry: StepExecutorRegistry;
  eventBus: TypedEventBus;
  activeFlowRegistry: ActiveFlowRegistry;
  /** Named model presets ("smart", "medium", ...) from forge config. */
  models?: Readonly<Record<string, AgentModelConfig>>;
  /** Constructs a cli `RoutineTool` for one routine of a registered flow. */
  createRoutineTool: CreateRoutineTool;
}

/**
 * Discovers flow definitions in a directory and registers their
 * orchestrator commands and routine tools with the pi extension.
 */
export class FlowRegistrar {
  /** Shared flow map keyed by flow name, populated during registerAll. */
  readonly flowMap = new Map<string, FlowDefinition>();

  constructor(private readonly context: FlowRegistrarContext) {}

  /**
   * Discover flow directories, load each flow definition, and register
   * orchestrator commands and routine tools.
   *
   * Flows are deduplicated by their directory name across
   * {@link FlowRegistrarContext.flowDirs}: a name is claimed once the
   * nearer copy's definition is validated and entered into the shared
   * {@link flowMap} (the `flowMap.set` in registerFlow is the claim
   * point), so the nearest directory that contains a HEALTHY copy wins
   * and later occurrences of the same name are skipped once claimed. A
   * nearer-layer copy that is skipped (unreadable flow.json or one
   * declaring no usable name, a name/directory mismatch, a spec-load
   * failure, a flow-validation failure, or a session-wiring construction
   * failure) does NOT shadow a deeper layer: its name stays unclaimed,
   * the next layer down is attempted, and each skip is logged as a
   * warning per flow. This makes cross-directory overrides first-wins for
   * healthy copies (the nearest layer claims the flow) while letting the
   * [config extras, project, global, packaged] cascade fall back to the
   * deepest healthy copy, and prevents duplicate flow/tool/command
   * registration and the flowMap overwrite across layer dirs.
   *
   * Tool/command REGISTRATION failures are the one non-fatal exception to
   * the claim condition: a tool or command whose `registerInstance`
   * throws (e.g. its name is already taken in the registry) is warned
   * about and skipped WITHOUT releasing the claim - the definition is
   * healthy and already in {@link flowMap}, and releasing the name would
   * send the deeper copy through the same failing registration while
   * re-registering every tool and command this copy already registered
   * (double registration). A CONSTRUCTION throw after the claim point, in
   * contrast, rolls the `flowMap` entry back (registerFlow deletes it
   * before returning false) because this layer proved unable to wire the
   * flow at all - the next layer down then claims the name cleanly. All
   * session objects are constructed before any of them is registered, so
   * a construction throw leaves no stale tool/command registrations
   * behind from the failed copy.
   *
   * Known spec-claims shadow limitation (documented, not rolled back;
   * see issue #257 and ADR 0028): a nearer copy that fails AFTER its
   * flow-dir specs loaded leaves those spec claims in the shared
   * SpecRegistry, so a deeper copy's same-named persona may resolve to
   * stale content - see the registerFlow JSDoc for the full trigger set.
   *
   * The shared {@link flowMap} is populated as each flow is loaded, then
   * threaded to the {@link StepExecutorRegistry} after all flows are
   * registered so that cross-flow routine refs can be resolved.
   */
  async registerAll(): Promise<void> {
    const { flowDirs } = this.context;
    const seenFlowNames = new Set<string>();

    for (const flowDir of flowDirs) {
      const flowNames = await discoverFlowDirectories(flowDir);
      for (const flowName of flowNames) {
        if (seenFlowNames.has(flowName)) {
          continue;
        }
        // Claim the name only when this copy actually registers: a skipped
        // or broken nearer-layer copy must not shadow a deeper layer's
        // healthy copy (the deeper dir is attempted next, name still free).
        const registered = await this.registerFlow(
          flowName,
          path.join(flowDir, flowName),
          this.context,
        );
        if (registered) {
          seenFlowNames.add(flowName);
        }
      }
    }

    // Thread the fully populated flowMap to executors that need it
    // for cross-flow routine ref resolution.
    this.context.stepExecutorRegistry.setFlowMap(this.flowMap);
  }

  /**
   * Attempt to register one flow copy: the orchestrator-spec ids loaded
   * from the flow dir are registered in the shared SpecRegistry BEFORE the
   * flow definition is validated, and they stay registered when the flow
   * later fails validation here. Known limitation (documented, not rolled
   * back; see issue #257 and ADR 0028): a deeper copy declaring the same
   * persona id would resolve to this nearer copy's persona content -
   * registerIfAbsent is first-wins. The shadow applies whenever this copy
   * fails AFTER its flow-dir specs loaded: a partial spec-load throw, a
   * flow-validation failure, or a session-wiring construction failure
   * (all roll the flowMap entry back / leave the name unclaimed, but do
   * not retract the spec claims). A copy rejected earlier (name guard)
   * never loaded specs, so it leaves nothing behind.
   *
   * @returns true when the copy registered (name claimed); false when it
   *   was skipped or rolled back (a deeper layer may claim the name).
   */
  private async registerFlow(
    flowName: string,
    flowDir: string,
    ctx: FlowRegistrarContext,
  ): Promise<boolean> {
    // Dir-name/flow-name guard, checked BEFORE the spec-load side effect:
    // registerAll dedupes flows by their directory name, so a flow.json
    // whose `name` diverges from its directory would slip past the dedupe
    // and land in the shared flowMap under a different key. Peek at the
    // declared name via FlowLoader.peekDeclaredName - the single source
    // for the flow.json format (FlowLoader.load still performs the full
    // parse/validation on healthy dirs) - and skip the flow WITHOUT
    // loading its orchestrator specs into the shared SpecRegistry when
    // the name is unusable (missing/unreadable flow.json or JSON that
    // declares no string name, incl. a `null` document) or mismatches
    // the directory.
    const declaredName = await FlowLoader.peekDeclaredName(flowDir);
    if (declaredName === undefined) {
      logger.warn(
        `[feature-forge] Skipping flow directory "${flowName}": flow.json is missing, ` +
          "unreadable, or declares no string name",
      );
      return false;
    }
    if (declaredName !== path.basename(flowDir)) {
      logger.warn(
        `[feature-forge] Skipping flow directory "${flowName}": flow.json declares ` +
          `name "${declaredName}", which does not match its directory name`,
      );
      return false;
    }

    // Load the flow dir's orchestrator specs first - the FlowLoader
    // validates that flow.orchestrator.systemPrompt names a registered
    // spec, so specs must be loaded before the loader is constructed. A
    // failure here returns false and leaves the name unclaimed so a deeper
    // layer's copy can still register.
    try {
      await ctx.specManager.loadFromDirectory(flowDir);
    } catch (error) {
      logger.warn(`[feature-forge] Failed to load orchestrator specs for flow "${flowName}"`, {
        error,
      });
      return false;
    }

    // Load and validate the flow definition. A failure here (schema
    // rejection, invalid JSON, unresolved references) returns false and
    // leaves the name unclaimed so a deeper layer's copy can still
    // register.
    const knownSpecs = ctx.specManager.specNames();
    const flowLoader = new FlowLoader({
      flowsDir: flowDir,
      knownSpecs,
      knownProviders: ctx.knownProviders,
    });
    let flow: FlowDefinition;
    try {
      flow = await flowLoader.load("flow");
    } catch (error) {
      logger.warn(`[feature-forge] Failed to load flow "${flowName}"`, { error });
      return false;
    }

    const store = new FlowStateStore();
    this.flowMap.set(flow.name, flow);
    for (const param of flow.params ?? []) {
      if (param.default !== undefined) {
        store.set(param.name, param.default);
      }
    }

    // ── Session wiring: construct first, register second ──
    // The claim happened at the flowMap.set above, but only sticks when
    // the wiring below succeeds end to end. Everything the session needs
    // (RoutineExecutor, every routine tool, the OrchestratorCommand) is
    // CONSTRUCTED before anything is REGISTERED: a construction throw then
    // rolls back cleanly (flowMap.delete below, nothing left in the tool or
    // command registries from this copy), so the next layer down claims the
    // name without colliding with stale registrations. A REGISTRATION
    // failure, by contrast, is non-fatal (warned - the definition is
    // healthy and stays claimed, so a deeper copy is not attempted and
    // cannot double-register this copy's tools/commands).
    let routineExecutor: RoutineExecutor;
    const routineTools: Tool[] = [];
    let orchestratorCommand: OrchestratorCommand;
    try {
      routineExecutor = new RoutineExecutor(
        flow,
        ctx.stepExecutorRegistry,
        ctx.eventBus,
        ctx.toolRegistry,
        store,
      );
      for (const routineDef of flow.routines) {
        routineTools.push(
          ctx.createRoutineTool(flowName, routineDef, routineExecutor, ctx.supervisor),
        );
      }
      orchestratorCommand = new OrchestratorCommand({
        supervisor: ctx.supervisor,
        pi: ctx.pi,
        specManager: ctx.specManager,
        toolRegistry: ctx.toolRegistry,
        workspaceManager: ctx.workspaceManager,
        flow,
        store,
        activeFlow: ctx.activeFlowRegistry,
        models: ctx.models,
      });
    } catch (error) {
      logger.warn(
        `[feature-forge] Failed to construct routine tools or orchestrator command for ` +
          `flow "${flowName}" - releasing its name for a deeper layer`,
        { error },
      );
      this.flowMap.delete(flow.name);
      return false;
    }

    // Registration pass: separated from construction so a construction
    // throw above leaves NO tools/commands registered from this copy.
    // Registration failures stay non-fatal - the definition is healthy and
    // already claimed, so a deeper copy must not be attempted.
    for (const routineTool of routineTools) {
      try {
        ctx.toolRegistry.registerInstance(routineTool);
      } catch (error) {
        logger.warn(`[feature-forge] Failed to register RoutineTool "${routineTool.name}"`, {
          error,
        });
      }
    }
    try {
      ctx.cmdRegistry.registerInstance(orchestratorCommand);
    } catch (error) {
      logger.warn(`[feature-forge] Failed to register OrchestratorCommand for "${flowName}"`, {
        error,
      });
    }

    // The flow definition parsed, validated, entered the shared flowMap,
    // and was wired into the session - the copy is registered, so the
    // name is claimed.
    return true;
  }
}
