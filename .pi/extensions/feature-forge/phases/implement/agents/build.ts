import { SubAgent } from "./base";

export class BuildAgent extends SubAgent {
  readonly name = "build";
  protected readonly promptFile = "build.md";
}
