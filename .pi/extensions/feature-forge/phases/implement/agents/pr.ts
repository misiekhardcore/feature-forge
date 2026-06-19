import { SubAgent } from "./base";

export class PrAgent extends SubAgent {
  readonly name = "pr";
  protected readonly promptFile = "pr.md";
}
