import { SubAgent } from "./base";

export class VerifyAgent extends SubAgent {
  readonly name = "verify";
  protected readonly promptFile = "verify.md";
}
