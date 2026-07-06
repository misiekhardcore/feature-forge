import { describe, expect, it } from "vitest";

import { ExpressionEvaluator, type FlowContextLike } from "./ExpressionEvaluator";

function makeCtx(
  results: Record<string, { raw: string; parsed?: { passed: boolean } }> = {},
): FlowContextLike {
  return { results: new Map(Object.entries(results)) };
}

// ---------------------------------------------------------------------------
// Parsing (syntax validation)
// ---------------------------------------------------------------------------

describe("parseExpression", () => {
  describe("literals", () => {
    it("parses true", () => {
      expect(ExpressionEvaluator.parseExpression("true")).toEqual({
        type: "literal",
        value: true,
      });
    });

    it("parses false", () => {
      expect(ExpressionEvaluator.parseExpression("false")).toEqual({
        type: "literal",
        value: false,
      });
    });

    it("parses null", () => {
      expect(ExpressionEvaluator.parseExpression("null")).toEqual({
        type: "literal",
        value: null,
      });
    });

    it("parses a number", () => {
      expect(ExpressionEvaluator.parseExpression("42")).toEqual({
        type: "literal",
        value: 42,
      });
    });

    it("parses a single-quoted string", () => {
      expect(ExpressionEvaluator.parseExpression("'hello'")).toEqual({
        type: "literal",
        value: "hello",
      });
    });
  });

  describe("paths", () => {
    it("parses a simple path", () => {
      expect(ExpressionEvaluator.parseExpression("results.a")).toEqual({
        type: "path",
        segments: ["results", "a"],
        optional: [false, false],
      });
    });

    it("parses a deep path", () => {
      expect(ExpressionEvaluator.parseExpression("results.a.parsed.passed")).toEqual({
        type: "path",
        segments: ["results", "a", "parsed", "passed"],
        optional: [false, false, false, false],
      });
    });

    it("parses optional chaining", () => {
      // "results.a?.parsed?.passed" → ".a" is required, "?.parsed" and "?.passed" are optional
      expect(ExpressionEvaluator.parseExpression("results.a?.parsed?.passed")).toEqual({
        type: "path",
        segments: ["results", "a", "parsed", "passed"],
        optional: [false, false, true, true],
      });
    });
  });

  describe("unary not", () => {
    it("parses a simple negation", () => {
      expect(ExpressionEvaluator.parseExpression("!true")).toEqual({
        type: "unary",
        operator: "not",
        operand: { type: "literal", value: true },
      });
    });

    it("parses double negation", () => {
      const ast = ExpressionEvaluator.parseExpression("!!true");
      expect(ast).toMatchObject({
        type: "unary",
        operator: "not",
        operand: { type: "unary", operator: "not" },
      });
    });
  });

  describe("binary operators", () => {
    it("parses AND", () => {
      const ast = ExpressionEvaluator.parseExpression("true && false");
      expect(ast).toMatchObject({
        type: "binary",
        operator: "and",
        left: { type: "literal", value: true },
        right: { type: "literal", value: false },
      });
    });

    it("parses OR", () => {
      const ast = ExpressionEvaluator.parseExpression("true || false");
      expect(ast).toMatchObject({
        type: "binary",
        operator: "or",
      });
    });
  });

  describe("operator precedence", () => {
    it("AND binds tighter than OR", () => {
      // "a || b && c" → a || (b && c)
      const ast = ExpressionEvaluator.parseExpression("true || false && true");
      expect(ast).toMatchObject({
        type: "binary",
        operator: "or",
        left: { type: "literal" },
        right: { type: "binary", operator: "and" },
      });
    });

    it("NOT binds tighter than AND", () => {
      // "!a && b" → (!a) && b
      const ast = ExpressionEvaluator.parseExpression("!true && false");
      expect(ast).toMatchObject({
        type: "binary",
        operator: "and",
        left: { type: "unary", operator: "not" },
      });
    });

    it("parentheses override precedence", () => {
      // "!(a || b)" applies NOT to the OR
      const ast = ExpressionEvaluator.parseExpression("!(true || false)");
      expect(ast).toMatchObject({
        type: "unary",
        operator: "not",
        operand: { type: "binary", operator: "or" },
      });
    });
  });

  describe("the implement expression", () => {
    it("parses successfully", () => {
      const expr =
        "!results.builder?.parsed?.passed || !results.review?.parsed?.passed || !results.verify?.parsed?.passed";
      const ast = ExpressionEvaluator.parseExpression(expr);
      expect(ast).toMatchObject({ type: "binary", operator: "or" });
    });
  });

  describe("errors", () => {
    it("throws on invalid syntax", () => {
      expect(() => ExpressionEvaluator.parseExpression("true + false")).toThrow();
    });

    it("throws on unterminated paren", () => {
      expect(() => ExpressionEvaluator.parseExpression("(true")).toThrow();
    });

    it("includes position in error", () => {
      try {
        ExpressionEvaluator.parseExpression("true @ false");
      } catch (e: unknown) {
        expect((e as { pos: number }).pos).toBeGreaterThan(0);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

describe("evaluateExpression", () => {
  describe("literals", () => {
    it("evaluates true as true", () => {
      expect(ExpressionEvaluator.evaluateExpression("true", makeCtx())).toBe(true);
    });

    it("evaluates false as false", () => {
      expect(ExpressionEvaluator.evaluateExpression("false", makeCtx())).toBe(false);
    });
  });

  describe("not", () => {
    it("negates true", () => {
      expect(ExpressionEvaluator.evaluateExpression("!true", makeCtx())).toBe(false);
    });

    it("negates false", () => {
      expect(ExpressionEvaluator.evaluateExpression("!false", makeCtx())).toBe(true);
    });
  });

  describe("and / or", () => {
    it("true && false → false", () => {
      expect(ExpressionEvaluator.evaluateExpression("true && false", makeCtx())).toBe(false);
    });

    it("true || false → true", () => {
      expect(ExpressionEvaluator.evaluateExpression("true || false", makeCtx())).toBe(true);
    });
  });

  describe("path resolution", () => {
    it("resolves a passed review result", () => {
      const ctx = makeCtx({
        review: { raw: "ok", parsed: { passed: true } },
      });
      expect(ExpressionEvaluator.evaluateExpression("results.review.parsed.passed", ctx)).toBe(
        true,
      );
    });

    it("resolves a failed review result", () => {
      const ctx = makeCtx({
        review: { raw: "issues", parsed: { passed: false } },
      });
      expect(ExpressionEvaluator.evaluateExpression("results.review.parsed.passed", ctx)).toBe(
        false,
      );
    });

    it("optional chain returns falsy for missing id", () => {
      const ctx = makeCtx({});
      // "results?.missing?.parsed?.passed" — all segments optional
      expect(ExpressionEvaluator.evaluateExpression("results?.missing?.parsed?.passed", ctx)).toBe(
        false,
      );
    });

    it("required chain throws for missing id", () => {
      const ctx = makeCtx({});
      expect(() =>
        ExpressionEvaluator.evaluateExpression("results.missing.parsed.passed", ctx),
      ).toThrow();
    });

    it("optional chain returns undefined-equivalent for missing property", () => {
      const ctx = makeCtx({
        review: { raw: "ok" }, // no parsed
      });
      expect(ExpressionEvaluator.evaluateExpression("results.review?.parsed?.passed", ctx)).toBe(
        false,
      );
    });
  });

  describe("the implement expression", () => {
    const expr =
      "!results.builder?.parsed?.passed || !results.review?.parsed?.passed || !results.verify?.parsed?.passed";

    it("returns true when builder fails", () => {
      const ctx = makeCtx({
        builder: { raw: "fail", parsed: { passed: false } },
        review: { raw: "ok", parsed: { passed: true } },
        verify: { raw: "ok", parsed: { passed: true } },
      });
      expect(ExpressionEvaluator.evaluateExpression(expr, ctx)).toBe(true);
    });

    it("returns true when review fails", () => {
      const ctx = makeCtx({
        builder: { raw: "ok", parsed: { passed: true } },
        review: { raw: "issues", parsed: { passed: false } },
        verify: { raw: "ok", parsed: { passed: true } },
      });
      expect(ExpressionEvaluator.evaluateExpression(expr, ctx)).toBe(true);
    });

    it("returns true when verify fails", () => {
      const ctx = makeCtx({
        builder: { raw: "ok", parsed: { passed: true } },
        review: { raw: "ok", parsed: { passed: true } },
        verify: { raw: "issues", parsed: { passed: false } },
      });
      expect(ExpressionEvaluator.evaluateExpression(expr, ctx)).toBe(true);
    });

    it("returns false when all three pass (exit loop)", () => {
      const ctx = makeCtx({
        builder: { raw: "ok", parsed: { passed: true } },
        review: { raw: "ok", parsed: { passed: true } },
        verify: { raw: "ok", parsed: { passed: true } },
      });
      expect(ExpressionEvaluator.evaluateExpression(expr, ctx)).toBe(false);
    });

    it("throws when builder is missing (id segment is required)", () => {
      const ctx = makeCtx({
        review: { raw: "ok", parsed: { passed: true } },
        verify: { raw: "ok", parsed: { passed: true } },
      });
      expect(() => ExpressionEvaluator.evaluateExpression(expr, ctx)).toThrow();
    });
  });

  describe("short-circuit evaluation", () => {
    it("OR short-circuits on first true", () => {
      // second operand accesses a missing path that would throw
      const expr = "true || results.missing.field";
      expect(ExpressionEvaluator.evaluateExpression(expr, makeCtx())).toBe(true);
    });

    it("AND short-circuits on first false", () => {
      const expr = "false && results.missing.field";
      expect(ExpressionEvaluator.evaluateExpression(expr, makeCtx())).toBe(false);
    });
  });
});
