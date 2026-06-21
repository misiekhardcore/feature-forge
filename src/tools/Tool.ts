import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Registrable } from "../registry";

export interface ToolExecuteResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export abstract class Tool implements Registrable {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract execute(
    args: Record<string, unknown>,
    ctx: ExtensionContext,
  ): Promise<ToolExecuteResult>;
}
