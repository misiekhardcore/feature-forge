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

  describe("equality operators", () => {
    it("parses === into an eq binary node", () => {
      expect(ExpressionEvaluator.parseExpression("results.a === 'x'")).toEqual({
        type: "binary",
        operator: "eq",
        left: { type: "path", segments: ["results", "a"], optional: [false, false] },
        right: { type: "literal", value: "x" },
      });
    });

    it("parses !== into a neq binary node", () => {
      expect(ExpressionEvaluator.parseExpression("a !== b")).toMatchObject({
        type: "binary",
        operator: "neq",
      });
    });

    it("equality binds tighter than AND", () => {
      // "a === b && c" → (a === b) && c
      const ast = ExpressionEvaluator.parseExpression("a === b && c");
      expect(ast).toMatchObject({
        type: "binary",
        operator: "and",
        left: { type: "binary", operator: "eq" },
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

    it("bare = and != (single =) still throw", () => {
      expect(() => ExpressionEvaluator.parseExpression("a = b")).toThrow(/Unexpected character/);
      expect(() => ExpressionEvaluator.parseExpression("a != b")).toThrow(/Unexpected character/);
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

    it("optional chain returns falsy when an intermediate value is null", () => {
      const ctx = makeCtx({
        review: null as unknown as { raw: string },
      });
      expect(ExpressionEvaluator.evaluateExpression("results.review?.parsed?.passed", ctx)).toBe(
        false,
      );
    });

    it("optional chain returns falsy when walking into a non-object", () => {
      const ctx = makeCtx({
        review: { raw: "just a string" },
      });
      expect(ExpressionEvaluator.evaluateExpression("results.review.raw?.length", ctx)).toBe(false);
    });

    it("required chain throws when walking into a non-object", () => {
      const ctx = makeCtx({
        review: { raw: "just a string" },
      });
      expect(() =>
        ExpressionEvaluator.evaluateExpression("results.review.raw.length", ctx),
      ).toThrow(/Cannot access property/);
    });

    it("required chain throws for a missing property", () => {
      const ctx = makeCtx({
        review: { raw: "ok" },
      });
      expect(() => ExpressionEvaluator.evaluateExpression("results.review.missing", ctx)).toThrow(
        /Property "missing" not found/,
      );
    });

    it("throws for a path with no id segment", () => {
      expect(() => ExpressionEvaluator.evaluateExpression("results", makeCtx())).toThrow(
        /Path too short/,
      );
    });

    it("throws for an unknown root", () => {
      expect(() => ExpressionEvaluator.evaluateExpression("params.foo", makeCtx())).toThrow(
        /Unknown root/,
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

  describe("equality", () => {
    it("'x' === 'x' → true", () => {
      expect(ExpressionEvaluator.evaluateExpression("'x' === 'x'", makeCtx())).toBe(true);
    });

    it("'x' === 'y' → false", () => {
      expect(ExpressionEvaluator.evaluateExpression("'x' === 'y'", makeCtx())).toBe(false);
    });

    it("true !== false → true", () => {
      expect(ExpressionEvaluator.evaluateExpression("true !== false", makeCtx())).toBe(true);
    });

    it("compares against a result raw value", () => {
      const okCtx = makeCtx({ review: { raw: "ok" } });
      expect(ExpressionEvaluator.evaluateExpression("results.review.raw === 'ok'", okCtx)).toBe(
        true,
      );
      const issuesCtx = makeCtx({ review: { raw: "issues" } });
      expect(ExpressionEvaluator.evaluateExpression("results.review.raw === 'ok'", issuesCtx)).toBe(
        false,
      );
    });

    it("passed === true → true when passed", () => {
      const ctx = makeCtx({ review: { raw: "ok", parsed: { passed: true } } });
      expect(
        ExpressionEvaluator.evaluateExpression("results.review?.parsed?.passed === true", ctx),
      ).toBe(true);
    });

    it("passed === true → false when missing (undefined === true)", () => {
      const ctx = makeCtx({ review: { raw: "ok" } }); // no parsed
      expect(
        ExpressionEvaluator.evaluateExpression("results.review?.parsed?.passed === true", ctx),
      ).toBe(false);
    });

    it("passed !== true → true when missing", () => {
      const ctx = makeCtx({ review: { raw: "ok" } }); // no parsed
      expect(
        ExpressionEvaluator.evaluateExpression("results.review?.parsed?.passed !== true", ctx),
      ).toBe(true);
    });

    it("compares raw values with strict equality (no coercion)", () => {
      expect(ExpressionEvaluator.evaluateExpression("'true' === true", makeCtx())).toBe(false);
      expect(ExpressionEvaluator.evaluateExpression("'1' === 1", makeCtx())).toBe(false);
    });

    it("null === null → true", () => {
      expect(ExpressionEvaluator.evaluateExpression("null === null", makeCtx())).toBe(true);
    });

    it("undefined === null → false (optional missing property)", () => {
      const ctx = makeCtx({ missing: { raw: "x" } });
      expect(ExpressionEvaluator.evaluateExpression("results.missing?.x === null", ctx)).toBe(
        false,
      );
    });

    it("AND short-circuits before evaluating a required equality path in the right operand", () => {
      const expr = "false && results.missing.parsed.passed === 'x'";
      expect(ExpressionEvaluator.evaluateExpression(expr, makeCtx())).toBe(false);
    });

    it("eq evaluates both sides — a throwing right operand is not skipped", () => {
      // Left side is optional and resolves to undefined, but equality must
      // still evaluate the right side, whose required id is missing.
      const ctx = makeCtx({ a: { raw: "x" } });
      expect(() =>
        ExpressionEvaluator.evaluateExpression(
          "results.a?.passed === results.missing.parsed.passed",
          ctx,
        ),
      ).toThrow('No result found for id "missing"');
    });

    it("neq evaluates both sides — a throwing right operand is not skipped", () => {
      const ctx = makeCtx({ a: { raw: "x" } });
      expect(() =>
        ExpressionEvaluator.evaluateExpression("results.a?.passed !== results.missing.raw", ctx),
      ).toThrow('No result found for id "missing"');
    });
  });

  describe("equality operator precedence and lexer gaps", () => {
    it("=== binds tighter than ||", () => {
      // "a === true || b === true" → (a === true) || (b === true).
      // The id segments are optional (`results?.a?.parsed?.passed`) so a missing
      // step resolves to undefined instead of throwing - required-id semantics
      // are covered elsewhere; this test locks in the precedence.
      const expr = "results?.a?.parsed?.passed === true || results?.b?.parsed?.passed === true";

      // true when a passes (OR short-circuits, b is never evaluated)
      const aPasses = makeCtx({ a: { raw: "ok", parsed: { passed: true } } });
      expect(ExpressionEvaluator.evaluateExpression(expr, aPasses)).toBe(true);

      // true when a is missing (undefined === true → false) but b passes
      const bPasses = makeCtx({ b: { raw: "ok", parsed: { passed: true } } });
      expect(ExpressionEvaluator.evaluateExpression(expr, bPasses)).toBe(true);

      // false when both are missing
      expect(ExpressionEvaluator.evaluateExpression(expr, makeCtx({}))).toBe(false);
    });

    it("! binds tighter than ===", () => {
      // "!results.missing?.x === false" parses as (!results.missing?.x) === false:
      // the missing.x path resolves to undefined, so (!undefined) === false →
      // true === false → false. If ! bound looser (!(undefined === false)) the
      // result would be true - this test locks in the tighter binding.
      const ast = ExpressionEvaluator.parseExpression("!results.missing?.x === false");
      expect(ast).toMatchObject({
        type: "binary",
        operator: "eq",
        left: { type: "unary", operator: "not" },
        right: { type: "literal", value: false },
      });

      const ctx = makeCtx({ missing: { raw: "x" } }); // result exists, .x does not
      expect(ExpressionEvaluator.evaluateExpression("!results.missing?.x === false", ctx)).toBe(
        false,
      );
    });

    it("=== is left-associative", () => {
      // "'a' === 'a' === true" → ('a' === 'a') === true → true === true
      expect(ExpressionEvaluator.evaluateExpression("'a' === 'a' === true", makeCtx())).toBe(true);
      // "'a' === 'b' === false" → ('a' === 'b') === false → false === false
      expect(ExpressionEvaluator.evaluateExpression("'a' === 'b' === false", makeCtx())).toBe(true);
    });

    it("rejects a single = (== is not a token)", () => {
      expect(() => ExpressionEvaluator.parseExpression("results.a == 'x'")).toThrow();
    });
  });

  describe("path strictness: mixed optional/required chains (first-failure-wins)", () => {
    // Path walking stops at the first failing segment. A required segment after
    // an optional miss never evaluates: `a?.b.c` with `b` missing resolves the
    // whole path to undefined (`false`) instead of throwing on `c`.
    const deepCtx = (value: unknown) =>
      ({ results: new Map<string, unknown>([["a", value]]) }) as unknown as FlowContextLike;

    it("a?.b.c with b missing evaluates to false (required c never throws)", () => {
      const ctx = makeCtx({ a: { raw: "x" } });
      expect(ExpressionEvaluator.evaluateExpression("results.a?.b.c === 'z'", ctx)).toBe(false);
    });

    it("a.b.c all-required with b missing still throws", () => {
      const ctx = makeCtx({ a: { raw: "x" } });
      expect(() => ExpressionEvaluator.evaluateExpression("results.a.b.c === 'z'", ctx)).toThrow(
        'Property "b" not found',
      );
    });

    it("mixed chain resolves normally when every segment is present", () => {
      const ctx = deepCtx({ raw: "x", b: { c: "z" } });
      expect(ExpressionEvaluator.evaluateExpression("results.a?.b.c === 'z'", ctx)).toBe(true);
      expect(ExpressionEvaluator.evaluateExpression("results.a?.b.c === 'y'", ctx)).toBe(false);
    });

    it("optional id + optional segment with required tail: missing id -> false", () => {
      const ctx = deepCtx(undefined);
      expect(ExpressionEvaluator.evaluateExpression("results?.a?.b.c === 'z'", ctx)).toBe(false);
    });
  });
});
