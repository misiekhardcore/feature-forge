/**
 * Sandboxed expression parser and evaluator for `continueWhile` conditions.
 *
 * Grammar:
 *   expr    → or_expr
 *   or_expr → and_expr ("||" and_expr)*
 *   and_expr → unary ("&&" unary)*
 *   unary   → "!" unary | primary
 *   primary → "true" | "false" | "null" | NUMBER | STRING | "(" expr ")" | path
 *   path    → IDENT ("?." IDENT | "." IDENT)*
 */

// ── AST ──────────────────────────────────────────────────────

export type UnaryOp = "not";
export type BinaryOp = "and" | "or";

export type Expr =
  | { type: "literal"; value: boolean | null | number | string }
  | { type: "path"; segments: string[]; optional: boolean[] }
  | { type: "unary"; operator: UnaryOp; operand: Expr }
  | { type: "binary"; operator: BinaryOp; left: Expr; right: Expr };

// ── Lexer ────────────────────────────────────────────────────

interface Token {
  type:
    | "ident"
    | "dot"
    | "optionalDot"
    | "bang"
    | "and"
    | "or"
    | "lparen"
    | "rparen"
    | "true"
    | "false"
    | "null"
    | "number"
    | "string"
    | "eof";
  value?: string;
  pos: number;
}

// ── Parser (recursive descent) ───────────────────────────────

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export class ExpressionParser {
  private pos = 0;
  private readonly tokens: Token[];

  constructor(expr: string) {
    this.tokens = this.tokenize(expr);
  }

  // ── Lexer (tokenize) ────────────────────────────────────────

  private tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < input.length) {
      const ch = input[i];

      // Whitespace
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        i++;
        continue;
      }

      // Operators and punctuation
      if (ch === "!" && input[i + 1] !== "=") {
        tokens.push({ type: "bang", pos: i });
        i++;
        continue;
      }
      if (ch === "&" && input[i + 1] === "&") {
        tokens.push({ type: "and", pos: i });
        i += 2;
        continue;
      }
      if (ch === "|" && input[i + 1] === "|") {
        tokens.push({ type: "or", pos: i });
        i += 2;
        continue;
      }
      if (ch === "(") {
        tokens.push({ type: "lparen", pos: i });
        i++;
        continue;
      }
      if (ch === ")") {
        tokens.push({ type: "rparen", pos: i });
        i++;
        continue;
      }
      if (ch === "?" && input[i + 1] === ".") {
        tokens.push({ type: "optionalDot", pos: i });
        i += 2;
        continue;
      }
      if (ch === ".") {
        tokens.push({ type: "dot", pos: i });
        i++;
        continue;
      }

      // String (single-quoted)
      if (ch === "'") {
        const start = i;
        i++;
        let str = "";
        while (i < input.length && input[i] !== "'") {
          str += input[i];
          i++;
        }
        if (i >= input.length) {
          throw new ParseError(`Unterminated string at position ${start}`, start);
        }
        i++; // closing quote
        tokens.push({ type: "string", value: str, pos: start });
        continue;
      }

      // Number
      if (ch >= "0" && ch <= "9") {
        const start = i;
        let num = "";
        while (i < input.length && input[i] >= "0" && input[i] <= "9") {
          num += input[i];
          i++;
        }
        tokens.push({ type: "number", value: num, pos: start });
        continue;
      }

      // Identifiers and keywords
      if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
        const start = i;
        let ident = "";
        while (
          i < input.length &&
          ((input[i] >= "a" && input[i] <= "z") ||
            (input[i] >= "A" && input[i] <= "Z") ||
            (input[i] >= "0" && input[i] <= "9") ||
            input[i] === "_" ||
            input[i] === "-")
        ) {
          ident += input[i];
          i++;
        }
        if (ident === "true") {
          tokens.push({ type: "true", pos: start });
        } else if (ident === "false") {
          tokens.push({ type: "false", pos: start });
        } else if (ident === "null") {
          tokens.push({ type: "null", pos: start });
        } else {
          tokens.push({ type: "ident", value: ident, pos: start });
        }
        continue;
      }

      throw new ParseError(`Unexpected character '${ch}' at position ${i}`, i);
    }

    tokens.push({ type: "eof", pos: i });
    return tokens;
  }

  parse(): Expr {
    const expr = this.parseOr();
    this.expect("eof");
    return expr;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.match("or")) {
      const operator: BinaryOp = "or";
      const right = this.parseAnd();
      left = { type: "binary", operator, left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseUnary();
    while (this.match("and")) {
      const operator: BinaryOp = "and";
      const right = this.parseUnary();
      left = { type: "binary", operator, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.match("bang")) {
      return { type: "unary", operator: "not", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    if (this.match("true")) {
      return { type: "literal", value: true };
    }
    if (this.match("false")) {
      return { type: "literal", value: false };
    }
    if (this.match("null")) {
      return { type: "literal", value: null };
    }
    if (this.match("number")) {
      const value = Number(this.previous().value);
      return { type: "literal", value };
    }
    if (this.match("string")) {
      return { type: "literal", value: this.previous().value! };
    }
    if (this.match("lparen")) {
      const expr = this.parseOr();
      this.expect("rparen");
      return expr;
    }
    return this.parsePath();
  }

  private parsePath(): Expr {
    const token = this.expect("ident");
    const segments = [token.value!];
    const optional: boolean[] = [false];

    while (this.match("dot") || this.match("optionalDot")) {
      const isOptional = this.previous().type === "optionalDot";
      const next = this.expect("ident");
      segments.push(next.value!);
      optional.push(isOptional);
    }

    return { type: "path", segments, optional };
  }

  private match(type: Token["type"]): boolean {
    if (this.tokens[this.pos].type === type) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expect(type: Token["type"]): Token {
    const token = this.tokens[this.pos];
    if (token.type !== type) {
      throw new ParseError(
        `Expected ${type} but found ${token.type} at position ${token.pos}`,
        token.pos,
      );
    }
    this.pos++;
    return token;
  }

  private previous(): Token {
    return this.tokens[this.pos - 1];
  }
}
