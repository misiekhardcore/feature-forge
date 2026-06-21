import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Registrable } from "../registry";

export abstract class Command implements Registrable {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract execute(args: string, ctx: ExtensionCommandContext): Promise<void>;
}
