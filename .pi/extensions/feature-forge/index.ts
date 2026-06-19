import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { State } from "./state";
import { registerPhases } from "./phases/registry";
import { DiscoverPhase } from "./phases/discover";
import { DefinePhase } from "./phases/define";
import { ImplementPhase } from "./phases/implement";

export default function (pi: ExtensionAPI) {
  new State(pi);
  registerPhases(pi, [DiscoverPhase, DefinePhase, ImplementPhase]);
}
