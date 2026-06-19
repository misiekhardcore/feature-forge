import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Phase } from "./base";
import { State } from "../state";

type PhaseConstructor = new (pi: ExtensionAPI) => Phase;

export function registerPhases(...phaseClasses: PhaseConstructor[]): void {
  const pi = State.getInstance().getPi();
  for (const cls of phaseClasses) {
    const instance = new cls(pi);
    instance.register();
  }
}
