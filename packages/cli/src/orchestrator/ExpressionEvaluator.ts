import { Expr, ExpressionParser } from "./ExpressionParser";

export interface FlowContextLike {
  results: ReadonlyMap<string, { raw: string; parsed?: { passed: boolean } }>;
}

export class ExpressionEvaluator {
  /**
   * Parse an expression string into an AST.
   * Throws ParseError with position info if the syntax is invalid.
   *
   * Used at flow-load time to validate `continueWhile` expressions
   * before the flow is executed.
   */
  static parseExpression(expr: string): Expr {
    const parser = new ExpressionParser(expr);
    return parser.parse();
  }

  /**
   * Evaluate a parsed expression against a flow context.
   *
   * `path` nodes are resolved against `ctx.results` by walking the
   * segment chain. Optional segments (`?.`) return `undefined` for
   * missing keys; required segments (`.`) throw.
   *
   * Returns a boolean — suitable for `continueWhile` loop conditions.
   */
  static evaluateExpression(expr: string, ctx: FlowContextLike): boolean {
    const ast = this.parseExpression(expr);
    return this.evaluate(ast, ctx);
  }

  // ── Evaluator ────────────────────────────────────────────────

  private static evaluate(expr: Expr, ctx: FlowContextLike): boolean {
    switch (expr.type) {
      case "literal":
        return Boolean(expr.value);

      case "path": {
        const value = this.resolvePath(expr, ctx);
        return Boolean(value);
      }

      case "unary":
        return !this.evaluate(expr.operand, ctx);

      case "binary": {
        const left = this.evaluate(expr.left, ctx);
        if (expr.operator === "or" && left) return true; // short-circuit
        if (expr.operator === "and" && !left) return false; // short-circuit
        return this.evaluate(expr.right, ctx);
      }

      default:
        throw new Error(`Unknown expression type`);
    }
  }

  private static resolvePath(expr: Extract<Expr, { type: "path" }>, ctx: FlowContextLike): unknown {
    const root = expr.segments[0];
    if (root !== "results") {
      throw new Error(`Unknown root: "${root}" — only "results" is supported`);
    }

    const id = expr.segments[1];
    if (id === undefined) {
      throw new Error(`Path too short — expected "results.<id>..."`);
    }

    let current: unknown = ctx.results.get(id);
    if (current === undefined && !expr.optional[1]) {
      throw new Error(`No result found for id "${id}"`);
    }
    if (current === undefined) return undefined;

    // Walk into .raw or .parsed.passed etc.
    for (let index = 2; index < expr.segments.length; index++) {
      const key = expr.segments[index];
      const isOptional = expr.optional[index] ?? false;

      if (current === null || current === undefined) {
        if (isOptional) return undefined;
        throw new Error(`Cannot access "${key}" on ${String(current)}`);
      }

      if (typeof current !== "object") {
        if (isOptional) return undefined;
        throw new Error(`Cannot access property "${key}" on ${typeof current}`);
      }

      const next = (current as Record<string, unknown>)[key];
      if (next === undefined && !isOptional) {
        throw new Error(`Property "${key}" not found`);
      }
      current = next;
    }

    return current;
  }
}
