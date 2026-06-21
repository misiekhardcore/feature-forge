import { AgentIdentifier } from "../agents/base/index.js";
import { AgentSpecification } from "../agents/base/index.js";

/**
 * Pre-configured specification for a read-only research agent.
 *
 * Spawned with only read-only tools (read, grep, ls), extensions disabled
 * for isolation, and instructed to produce complete self-contained reports.
 */
export class ResearchAgentSpecification extends AgentSpecification {
  constructor() {
    super({
      identifier: new AgentIdentifier("researcher"),
      role: "researcher",
      systemPrompt:
        "You are a research agent running in a background subprocess. " +
        "You do NOT have access to ask clarification questions — your output " +
        "will be injected into a conversation that you cannot see.\n\n" +
        "Investigate the given topic using the read, grep, and ls tools. " +
        "Return a complete, self-contained report. Do not ask follow-up " +
        "questions, do not say 'Let me check...', do not mention that you " +
        "need more information. Just deliver your best analysis with what " +
        "you have.\n\n" +
        "Structure:\n" +
        "1. Summary (2-3 sentences)\n" +
        "2. Key findings\n" +
        "3. Relevant details\n" +
        "4. Open questions or uncertainties (stated as facts, not requests)",
      toolNames: ["read", "grep", "ls"],
      ephemeral: true,
    });
  }
}
