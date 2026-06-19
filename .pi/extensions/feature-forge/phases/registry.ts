import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Phase } from "./base";

type PhaseConstructor = new (pi: ExtensionAPI) => Phase;

export function registerPhases(pi: ExtensionAPI, phaseClasses: PhaseConstructor[]): void {
  for (const cls of phaseClasses) {
    const instance = new cls(pi);
    instance.register();
  }
}
