import { describe, expect, it } from "vitest";

import { fillTemplate } from "./templates";

describe("fillTemplate()", () => {
  it("replaces a single placeholder with the provided value", () => {
    const result = fillTemplate("Hello {{NAME}}!", { NAME: "World" });
    expect(result).toBe("Hello World!");
  });

  it("replaces multiple unique placeholders", () => {
    const result = fillTemplate("{{GREETING}}, {{TARGET}}!", {
      GREETING: "Hi",
      TARGET: "Alice",
    });
    expect(result).toBe("Hi, Alice!");
  });

  it("replaces repeated occurrences of the same placeholder", () => {
    const result = fillTemplate("{{X}} + {{X}} = {{Y}}", { X: "1", Y: "2" });
    expect(result).toBe("1 + 1 = 2");
  });

  it("leaves unknown placeholders unchanged", () => {
    const result = fillTemplate("Hello {{NAME}}!", {});
    expect(result).toBe("Hello {{NAME}}!");
  });

  it("returns the template as-is when no placeholders exist", () => {
    const result = fillTemplate("No placeholders here.", { X: "ignored" });
    expect(result).toBe("No placeholders here.");
  });

  it("handles empty values string gracefully", () => {
    const result = fillTemplate("Prefix{{PLACEHOLDER}}Suffix", { PLACEHOLDER: "" });
    expect(result).toBe("PrefixSuffix");
  });

  it("returns template as-is when values are omitted", () => {
    const result = fillTemplate("Hello {{NAME}}!");
    expect(result).toBe("Hello {{NAME}}!");
  });
});
