import { SubAgent } from "./base";

export class ReviewAgent extends SubAgent {
  readonly name = "review";
  protected readonly promptFile = "review.md";
}
