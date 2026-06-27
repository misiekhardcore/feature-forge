import { describe, expect, it } from "vitest";

import { isParsedResultPassed } from "./RoutineResult";

describe("isParsedResultPassed", () => {
  it("returns true for a build outcome with passed: true", () => {
    expect(isParsedResultPassed({ kind: "build", passed: true, summary: "ok" })).toBe(true);
  });

  it("returns false for a build outcome with passed: false", () => {
    expect(isParsedResultPassed({ kind: "build", passed: false, summary: "nope" })).toBe(false);
  });

  it("returns true for a review with passed: true", () => {
    expect(
      isParsedResultPassed({
        kind: "review",
        passed: true,
        findings: { critical: [], warnings: [], info: [] },
      }),
    ).toBe(true);
  });

  it("returns false for a review with passed: false", () => {
    expect(
      isParsedResultPassed({
        kind: "review",
        passed: false,
        findings: { critical: ["bug"], warnings: [], info: [] },
      }),
    ).toBe(false);
  });
});
