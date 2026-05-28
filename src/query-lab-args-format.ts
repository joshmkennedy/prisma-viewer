export type QueryLabArgsFormatResult =
  | { source: string }
  | { error: string };

type QueryLabArgsValue =
  | { kind: "object"; properties: QueryLabArgsProperty[] }
  | { kind: "array"; values: QueryLabArgsValue[] }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" }
  | { kind: "date"; value: string };

type QueryLabArgsProperty = {
  key: string;
  value: QueryLabArgsValue;
};

type Token =
  | { kind: "identifier"; value: string }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "punct"; value: "{" | "}" | "[" | "]" | "(" | ")" | ":" | "," | ";" }
  | { kind: "eof" };

class QueryLabArgsFormatError extends Error {}

export function formatQueryLabArgsSource(source: string): QueryLabArgsFormatResult {
  try {
    const parser = new QueryLabArgsFormatterParser(source);
    const value = parser.parse();
    return { source: formatValue(value, 0) };
  } catch (error) {
    return {
      error:
        error instanceof QueryLabArgsFormatError
          ? error.message
          : "Could not format Args Mode source.",
    };
  }
}

class QueryLabArgsFormatterParser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(source: string) {
    this.tokens = tokenize(source);
  }

  parse() {
    if (this.matchPunct(";")) this.fail("Args Mode source must be an object literal.");
    if (this.peek().kind === "eof") return { kind: "object", properties: [] } satisfies QueryLabArgsValue;

    const value = this.parseExpression();
    if (value.kind !== "object") this.fail("Args Mode source must be an object literal.");
    if (this.matchPunct(";") && this.peek().kind !== "eof") {
      this.fail("Args Mode source must contain exactly one object literal.");
    }
    this.expectEof();
    return value;
  }

  private parseExpression(): QueryLabArgsValue {
    if (this.matchPunct("(")) {
      const value = this.parseExpression();
      this.expectPunct(")");
      return value;
    }

    if (this.matchPunct("{")) return this.parseObject();
    if (this.matchPunct("[")) return this.parseArray();

    const token = this.advance();
    if (token.kind === "string") return { kind: "string", value: token.value };
    if (token.kind === "number") return { kind: "number", value: token.value };
    if (token.kind === "identifier") {
      if (token.value === "true") return { kind: "boolean", value: true };
      if (token.value === "false") return { kind: "boolean", value: false };
      if (token.value === "null") return { kind: "null" };
      if (token.value === "new") return this.parseNewExpression();
    }

    this.fail("Args Mode source contains unsupported syntax.");
  }

  private parseObject(): QueryLabArgsValue {
    const properties: QueryLabArgsProperty[] = [];
    if (this.matchPunct("}")) return { kind: "object", properties };

    while (true) {
      const key = this.parsePropertyKey();
      this.expectPunct(":");
      const value = this.parseExpression();
      properties.push({ key, value });

      if (this.matchPunct("}")) break;
      this.expectPunct(",");
      if (this.matchPunct("}")) break;
    }

    return { kind: "object", properties };
  }

  private parseArray(): QueryLabArgsValue {
    const values: QueryLabArgsValue[] = [];
    if (this.matchPunct("]")) return { kind: "array", values };

    while (true) {
      values.push(this.parseExpression());
      if (this.matchPunct("]")) break;
      this.expectPunct(",");
      if (this.matchPunct("]")) break;
    }

    return { kind: "array", values };
  }

  private parsePropertyKey() {
    const token = this.advance();
    if (token.kind === "identifier" || token.kind === "string") return token.value;
    if (token.kind === "number") return String(token.value);
    this.fail("Args Mode object property names must be identifiers, strings, or numbers.");
  }

  private parseNewExpression(): QueryLabArgsValue {
    const constructorToken = this.advance();
    if (constructorToken.kind !== "identifier" || constructorToken.value !== "Date") {
      this.fail("Args Mode only supports new Date(\"...\") constructor expressions.");
    }
    this.expectPunct("(");
    const value = this.advance();
    if (value.kind !== "string") {
      this.fail("Args Mode only supports new Date(\"...\") with one string literal argument.");
    }
    this.expectPunct(")");
    return { kind: "date", value: value.value };
  }

  private peek() {
    return this.tokens[this.index] ?? { kind: "eof" as const };
  }

  private advance() {
    const token = this.peek();
    if (token.kind !== "eof") this.index += 1;
    return token;
  }

  private matchPunct(value: Extract<Token, { kind: "punct" }>["value"]) {
    const token = this.peek();
    if (token.kind !== "punct" || token.value !== value) return false;
    this.index += 1;
    return true;
  }

  private expectPunct(value: Extract<Token, { kind: "punct" }>["value"]) {
    if (!this.matchPunct(value)) this.fail(`Expected "${value}" in Args Mode source.`);
  }

  private expectEof() {
    if (this.peek().kind !== "eof") {
      this.fail("Args Mode source must contain exactly one object literal.");
    }
  }

  private fail(message: string): never {
    throw new QueryLabArgsFormatError(message);
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (/\s/.test(char)) continue;

    if (char === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index + 2);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) throw new QueryLabArgsFormatError("Unclosed block comment in Args Mode source.");
      index = end + 1;
      continue;
    }

    if (isPunctuation(char)) {
      tokens.push({ kind: "punct", value: char });
      continue;
    }

    if (char === "\"" || char === "'") {
      const token = readStringToken(source, index, char);
      tokens.push({ kind: "string", value: token.value });
      index = token.end - 1;
      continue;
    }

    if (isNumberStart(source, index)) {
      const token = readNumberToken(source, index);
      tokens.push({ kind: "number", value: token.value });
      index = token.end - 1;
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[\w$]/.test(source[index])) index += 1;
      tokens.push({ kind: "identifier", value: source.slice(start, index) });
      index -= 1;
      continue;
    }

    throw new QueryLabArgsFormatError(`Unexpected "${char}" in Args Mode source.`);
  }

  tokens.push({ kind: "eof" });
  return tokens;
}

function readStringToken(source: string, start: number, quote: string) {
  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      const escaped = source[index + 1];
      if (escaped === undefined) break;
      value += decodeEscape(escaped);
      index += 1;
      continue;
    }
    if (char === quote) return { value, end: index + 1 };
    value += char;
  }

  throw new QueryLabArgsFormatError("Unclosed string in Args Mode source.");
}

function decodeEscape(value: string) {
  if (value === "n") return "\n";
  if (value === "r") return "\r";
  if (value === "t") return "\t";
  if (value === "b") return "\b";
  if (value === "f") return "\f";
  return value;
}

function readNumberToken(source: string, start: number) {
  const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(start));
  if (!match) throw new QueryLabArgsFormatError("Invalid number in Args Mode source.");
  return { value: Number(match[0]), end: start + match[0].length };
}

function isNumberStart(source: string, index: number) {
  const char = source[index];
  const next = source[index + 1];
  return /\d/.test(char) || char === "." || ((char === "+" || char === "-") && /[\d.]/.test(next));
}

function isPunctuation(value: string): value is Extract<Token, { kind: "punct" }>["value"] {
  return ["{", "}", "[", "]", "(", ")", ":", ",", ";"].includes(value);
}

function formatValue(value: QueryLabArgsValue, depth: number): string {
  if (value.kind === "object") return formatObject(value, depth);
  if (value.kind === "array") return formatArray(value, depth);
  if (value.kind === "string") return JSON.stringify(value.value);
  if (value.kind === "number") return String(value.value);
  if (value.kind === "boolean") return String(value.value);
  if (value.kind === "date") return `new Date(${JSON.stringify(value.value)})`;
  return "null";
}

function formatObject(value: Extract<QueryLabArgsValue, { kind: "object" }>, depth: number) {
  if (value.properties.length === 0) return "{}";

  const indentation = indent(depth);
  const childIndentation = indent(depth + 1);
  const lines = value.properties.map(
    (property) =>
      `${childIndentation}${formatPropertyKey(property.key)}: ${formatValue(property.value, depth + 1)}`,
  );
  return `{\n${lines.join(",\n")}\n${indentation}}`;
}

function formatArray(value: Extract<QueryLabArgsValue, { kind: "array" }>, depth: number) {
  if (value.values.length === 0) return "[]";
  if (value.values.every(isScalarValue)) {
    return `[${value.values.map((item) => formatValue(item, depth)).join(", ")}]`;
  }

  const indentation = indent(depth);
  const childIndentation = indent(depth + 1);
  const lines = value.values.map((item) => `${childIndentation}${formatValue(item, depth + 1)}`);
  return `[\n${lines.join(",\n")}\n${indentation}]`;
}

function formatPropertyKey(key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function isScalarValue(value: QueryLabArgsValue) {
  return ["string", "number", "boolean", "null", "date"].includes(value.kind);
}

function indent(depth: number) {
  return "  ".repeat(depth);
}
