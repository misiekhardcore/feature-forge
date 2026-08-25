import { describe, expect, it } from "vitest";

import type { TemplateLookup } from "./TemplateResolver";
import { TemplateResolver } from "./TemplateResolver";

function lookup(entries: Record<string, string>): TemplateLookup {
  return (token) => entries[token];
}

describe("TemplateResolver.resolve", () => {
  it("substitutes a known token", () => {
    expect(
      TemplateResolver.resolve("Build: {{prompt}}", (t) =>
        t === "prompt" ? "add auth" : undefined,
      ),
    ).toBe("Build: add auth");
  });

  it("substitutes multiple tokens independently", () => {
    const l = lookup({ a: "1", b: "2" });
    expect(TemplateResolver.resolve("{{a}}-{{b}}", l)).toBe("1-2");
  });

  it("keeps unknown tokens verbatim", () => {
    const l = lookup({});
    expect(TemplateResolver.resolve("Hello {{UNKNOWN}}", l)).toBe("Hello {{UNKNOWN}}");
  });

  it("trims token keys before lookup", () => {
    const l = lookup({ plan: "use JWT" });
    expect(TemplateResolver.resolve("{{ plan }}", l)).toBe("use JWT");
  });

  it("normalizes a kept unknown token to its trimmed form", () => {
    const l = lookup({});
    expect(TemplateResolver.resolve("{{ plan }}", l)).toBe("{{plan}}");
  });

  it("honors an empty-string substitution (not treated as missing)", () => {
    expect(TemplateResolver.resolve("a{{x}}b", () => "")).toBe("ab");
  });

  it("substitutes a token appearing twice", () => {
    const l = lookup({ x: "v" });
    expect(TemplateResolver.resolve("{{x}}|{{x}}", l)).toBe("v|v");
  });

  it("passes a template with no tokens through unchanged", () => {
    const l = lookup({});
    expect(TemplateResolver.resolve("plain text", l)).toBe("plain text");
  });

  it("passes a lone opening or closing brace through unchanged", () => {
    const l = lookup({});
    expect(TemplateResolver.resolve("a {{ b", l)).toBe("a {{ b");
    expect(TemplateResolver.resolve("a }} b", l)).toBe("a }} b");
  });

  it("returns an empty string for an empty template", () => {
    const l = lookup({});
    expect(TemplateResolver.resolve("", l)).toBe("");
  });

  it("passes an empty token through unchanged without calling the lookup", () => {
    let called = false;
    const result = TemplateResolver.resolve("{{}}", () => {
      called = true;
      return "x";
    });
    expect(result).toBe("{{}}");
    expect(called).toBe(false);
  });

  it("looks up a whitespace-only token as an empty key and substitutes when defined", () => {
    const l = lookup({ "": "x" });
    expect(TemplateResolver.resolve("{{ }}", l)).toBe("x");
  });

  it("keeps a whitespace-only token as its trimmed empty form when the lookup returns undefined", () => {
    const l = lookup({});
    expect(TemplateResolver.resolve("{{ }}", l)).toBe("{{}}");
  });

  it("does not recurse into substituted values", () => {
    const l = lookup({ a: "{{b}}" });
    expect(TemplateResolver.resolve("{{a}}", l)).toBe("{{b}}");
  });

  it("inserts substitution values containing $ literally (no replacement-pattern injection)", () => {
    const l = lookup({ a: "$&", b: "$1", c: "$$", d: "$`" });
    expect(TemplateResolver.resolve("{{a}}|{{b}}|{{c}}|{{d}}", l)).toBe("$&|$1|$$|$`");
  });

  it("passes a token containing } through unchanged (the character cannot be expressed)", () => {
    const l = lookup({ "a}b": "x" });
    expect(TemplateResolver.resolve("{{a}b}}", l)).toBe("{{a}b}}");
    expect(TemplateResolver.resolve("{{a}b}}", l)).not.toContain("x");
  });

  it("handles a token whose key contains whitespace around a middle token", () => {
    const l = lookup({ "a b": "c" });
    expect(TemplateResolver.resolve("{{a b}}", l)).toBe("c");
  });

  it("keeps an unknown token with inner whitespace in its trimmed form", () => {
    const l = lookup({});
    expect(TemplateResolver.resolve("{{ a b }}", l)).toBe("{{a b}}");
  });

  it("looks up a token containing a { character (the regex allows it)", () => {
    const l = lookup({ "a{{b": "v" });
    expect(TemplateResolver.resolve("{{a{{b}}", l)).toBe("v");
    expect(TemplateResolver.resolve("{{a{{b}}", () => undefined)).toBe("{{a{{b}}");
  });

  it("looks up a multiline token and substitutes when defined", () => {
    const l = lookup({ "first\nsecond": "v" });
    expect(TemplateResolver.resolve("{{first\nsecond}}", l)).toBe("v");
    expect(TemplateResolver.resolve("{{first\nsecond}}", () => undefined)).toBe(
      "{{first\nsecond}}",
    );
  });

  it("keeps the token when the lookup returns null (defensive guard)", () => {
    expect(TemplateResolver.resolve("{{x}}", () => null as unknown as string | undefined)).toBe(
      "{{x}}",
    );
  });
});
