import ts from "typescript";

export type QueryLabArgsParseResult =
  | { args: Record<string, unknown> }
  | { error: string };

export function parseQueryLabArgsSource(argsSource: string): QueryLabArgsParseResult {
  const trimmed = trimTrailingExpressionSemicolon(argsSource.trim());
  if (!trimmed) return { args: {} };

  const sourceText = `(${trimmed})`;
  const sourceFile = ts.createSourceFile(
    "query-lab-args.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const firstDiagnostic = getParseDiagnostics(sourceFile)[0];
  if (firstDiagnostic) {
    return { error: formatParseError(sourceFile, firstDiagnostic) };
  }

  if (sourceFile.statements.length !== 1) {
    return { error: "Args Mode source must contain exactly one object literal expression." };
  }

  const statement = sourceFile.statements[0];
  if (!ts.isExpressionStatement(statement)) {
    return { error: "Args Mode source must contain exactly one object literal expression." };
  }

  const expression = unwrapParentheses(statement.expression);
  if (!ts.isObjectLiteralExpression(expression)) {
    return { error: "Args Mode source must evaluate to an object literal." };
  }

  try {
    return { args: convertObjectLiteral(expression) };
  } catch (error) {
    return {
      error:
        error instanceof QueryLabArgsValidationError
          ? error.message
          : "Args Mode source contains unsupported syntax.",
    };
  }
}

class QueryLabArgsValidationError extends Error {}

function trimTrailingExpressionSemicolon(source: string) {
  return source.endsWith(";") ? source.slice(0, -1).trimEnd() : source;
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function convertObjectLiteral(node: ts.ObjectLiteralExpression): Record<string, unknown> {
  const object: Record<string, unknown> = {};

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new QueryLabArgsValidationError(
        "Args Mode object literals may only contain explicit property assignments.",
      );
    }

    object[convertPropertyName(property.name)] = convertExpression(property.initializer);
  }

  return object;
}

function convertPropertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  throw new QueryLabArgsValidationError(
    "Args Mode object property names must be identifiers, strings, or numbers.",
  );
}

function convertExpression(expression: ts.Expression): unknown {
  const node = unwrapParentheses(expression);

  if (ts.isObjectLiteralExpression(node)) return convertObjectLiteral(node);
  if (ts.isArrayLiteralExpression(node)) return convertArrayLiteral(node);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node)) return convertUnaryExpression(node);
  if (ts.isNewExpression(node)) return convertNewExpression(node);

  throw new QueryLabArgsValidationError(
    `Unsupported Args Mode expression: ${describeSyntaxKind(node.kind)}.`,
  );
}

function convertArrayLiteral(node: ts.ArrayLiteralExpression): unknown[] {
  return node.elements.map((element) => {
    if (ts.isSpreadElement(element)) {
      throw new QueryLabArgsValidationError("Args Mode arrays may not contain spread elements.");
    }

    return convertExpression(element);
  });
}

function convertUnaryExpression(node: ts.PrefixUnaryExpression) {
  const operator = node.operator;
  if (
    operator !== ts.SyntaxKind.MinusToken &&
    operator !== ts.SyntaxKind.PlusToken
  ) {
    throw new QueryLabArgsValidationError(
      "Args Mode only supports unary plus or minus for numeric literals.",
    );
  }

  const operand = unwrapParentheses(node.operand);
  if (!ts.isNumericLiteral(operand)) {
    throw new QueryLabArgsValidationError(
      "Args Mode unary plus or minus may only be used with numeric literals.",
    );
  }

  const value = Number(operand.text);
  return operator === ts.SyntaxKind.MinusToken ? -value : value;
}

function convertNewExpression(node: ts.NewExpression) {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "Date") {
    throw new QueryLabArgsValidationError(
      "Args Mode only supports new Date(\"...\") constructor expressions.",
    );
  }

  const args = node.arguments ?? [];
  if (args.length !== 1 || !ts.isStringLiteral(args[0])) {
    throw new QueryLabArgsValidationError(
      "Args Mode only supports new Date(\"...\") with one string literal argument.",
    );
  }

  const date = new Date(args[0].text);
  if (Number.isNaN(date.getTime())) {
    throw new QueryLabArgsValidationError("Args Mode new Date value must be a valid date string.");
  }

  return date;
}

function describeSyntaxKind(kind: ts.SyntaxKind) {
  return ts.SyntaxKind[kind] ?? "unknown syntax";
}

function formatParseError(sourceFile: ts.SourceFile, diagnostic: ts.DiagnosticWithLocation) {
  const position = sourceFile.getLineAndCharacterOfPosition(
    Math.max(0, diagnostic.start - 1),
  );
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  return `Args Mode source has invalid syntax at ${position.line + 1}:${position.character + 1}: ${message}`;
}

function getParseDiagnostics(sourceFile: ts.SourceFile) {
  return (
    sourceFile as ts.SourceFile & {
      parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
    }
  ).parseDiagnostics ?? [];
}
