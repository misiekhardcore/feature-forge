import { describe, expect, it } from "vitest";

import { BUILT_IN_TOOLS, TOOL_PRESETS } from "./constants";

describe("TOOL_PRESETS", () => {
  it("aliases reviewOnly to readOnly (same array, no duplication)", () => {
    expect(TOOL_PRESETS.reviewOnly).toBe(TOOL_PRESETS.readOnly);
  });

  it("readOnly contains read, grep, ls", () => {
    expect(TOOL_PRESETS.readOnly).toEqual([
      BUILT_IN_TOOLS.READ,
      BUILT_IN_TOOLS.GREP,
      BUILT_IN_TOOLS.LS,
    ]);
  });

  it("verify contains read, bash, grep, ls", () => {
    expect(TOOL_PRESETS.verify).toEqual([
      BUILT_IN_TOOLS.READ,
      BUILT_IN_TOOLS.BASH,
      BUILT_IN_TOOLS.GREP,
      BUILT_IN_TOOLS.LS,
    ]);
  });
});
