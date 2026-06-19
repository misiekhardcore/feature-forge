import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Phase } from "./base";

export function registerPhases(pi: ExtensionAPI, phases: Phase[]): void {
  for (const phase of phases) {
    phase.pi = pi;
    pi.registerCommand(phase.name, {
      description: phase.description,
      handler: phase.handler.bind(phase),
    });
  }
}
