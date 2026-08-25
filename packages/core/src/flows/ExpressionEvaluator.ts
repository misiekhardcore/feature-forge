import { Expr, ExpressionParser } from "./ExpressionParser";
import { ResultPathWalker } from "./resultPath";

export interface FlowContextLike {
  results: ReadonlyMap<string, { raw: string; parsed?: { passed: boolean } }>;
}

export class ExpressionEvaluator {
  /** Static utility class - not instantiable. */
  private constructor() {}

  /**
   * Parse an expression string into an AST.
   * Throws ParseError with position info if the syntax is invalid.
   *
   * Used at flow-load time to validate `while` and `continueWhile`
   * expressions before the flow is executed.
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
    return Boolean(this.evaluateValue(ast, ctx));
  }

  // ── Evaluator ────────────────────────────────────────────────

  private static evaluateValue(expr: Expr, ctx: FlowContextLike): unknown {
    switch (expr.type) {
      case "literal":
        return expr.value;

      case "path":
        return this.resolvePath(expr, ctx);

      case "unary":
        return !this.evaluateValue(expr.operand, ctx);

      case "binary": {
        const left = this.evaluateValue(expr.left, ctx);
        const op = expr.operator;
        switch (op) {
          case "or":
            return left ? left : this.evaluateValue(expr.right, ctx);
          case "and":
            return left ? this.evaluateValue(expr.right, ctx) : left;
          case "eq":
            return left === this.evaluateValue(expr.right, ctx);
          case "neq":
            return left !== this.evaluateValue(expr.right, ctx);
          default: {
            const exhaustive: never = op;
            throw new Error(`Unknown binary operator: ${String(exhaustive)}`);
          }
        }
      }

      default: {
        const exhaustive: never = expr;
        throw new Error(`Unknown expression type: ${JSON.stringify(exhaustive)}`);
      }
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

    const walked = ResultPathWalker.walk(ctx.results, id, expr.segments.slice(2));
    if (walked.ok) return walked.value;

    const failure = walked.failure;
    if (failure.reason === "no-result") {
      if (expr.optional[1]) return undefined;
      throw new Error(`No result found for id "${id}"`);
    }
    // failure.at is a 0-based index into the walked segments (i.e. segments[2..]);
    // map back to the AST optional[] index.
    const optional = expr.optional[failure.at + 2] ?? false;
    if (optional) return undefined;
    if (failure.reason === "missing-key") {
      throw new Error(`Property "${failure.key}" not found`);
    }
    // not-traversable - reconstruct the legacy messages
    if (failure.current === null || failure.current === undefined) {
      throw new Error(`Cannot access "${failure.key}" on ${String(failure.current)}`);
    }
    throw new Error(`Cannot access property "${failure.key}" on ${typeof failure.current}`);
  }
}
