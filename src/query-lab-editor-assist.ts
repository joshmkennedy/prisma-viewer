export type QueryLabAssistOperation = "findMany" | "findFirst" | "findUnique" | "count";

export type QueryLabAssistField = {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
  enumValues?: string[];
  isList: boolean;
};

export type QueryLabAssistModel = {
  name: string;
  fields: QueryLabAssistField[];
};

export type QueryLabAssistContext = {
  models: QueryLabAssistModel[];
  modelName: string;
  operation: QueryLabAssistOperation;
};

export type QueryLabCompletionKind =
  | "arg"
  | "field"
  | "relation"
  | "enum"
  | "operator"
  | "literal";

export type QueryLabCompletion = {
  label: string;
  insertText: string;
  kind: QueryLabCompletionKind;
  detail: string;
};

export type QueryLabEditorDiagnostic = {
  message: string;
  startOffset: number;
  endOffset: number;
};

const FIND_MANY_TOP_LEVEL_ARGS = ["where", "select", "include", "orderBy", "skip", "take"];
const FIND_FIRST_TOP_LEVEL_ARGS = ["where", "select", "include", "orderBy", "skip"];
const FIND_UNIQUE_TOP_LEVEL_ARGS = ["where", "select", "include"];
const COUNT_TOP_LEVEL_ARGS = ["where"];
const NESTED_RELATION_ARGS = FIND_MANY_TOP_LEVEL_ARGS;
const WHERE_LOGICAL_KEYS = ["AND", "OR", "NOT"];
const RELATION_FILTER_OPERATORS = ["is", "isNot", "some", "every", "none"];
const SCALAR_FILTER_OPERATORS = [
  "equals",
  "not",
  "in",
  "notIn",
  "lt",
  "lte",
  "gt",
  "gte",
  "contains",
  "startsWith",
  "endsWith",
  "has",
  "hasEvery",
  "hasSome",
  "isEmpty",
];

type QueryContext =
  | { kind: "root"; model: QueryLabAssistModel }
  | { kind: "topLevelValue"; key: string; model: QueryLabAssistModel }
  | { kind: "where"; model: QueryLabAssistModel }
  | { kind: "fieldFilter"; field: QueryLabAssistField; model: QueryLabAssistModel }
  | { kind: "fieldValue"; field: QueryLabAssistField; model: QueryLabAssistModel }
  | { kind: "relationFilter"; model: QueryLabAssistModel }
  | { kind: "select"; model: QueryLabAssistModel }
  | { kind: "include"; model: QueryLabAssistModel }
  | { kind: "relationArgs"; model: QueryLabAssistModel }
  | { kind: "orderBy"; model: QueryLabAssistModel }
  | { kind: "sortDirection"; model: QueryLabAssistModel };

type ObjectFrame = {
  kind: "object";
  key?: string;
  parentKey?: string;
  entries: Set<string>;
};

type ArrayFrame = {
  kind: "array";
  key?: string;
  parentKey?: string;
};

type Frame = ObjectFrame | ArrayFrame;

type Token =
  | { kind: "word"; value: string; start: number; end: number }
  | { kind: "punct"; value: "{" | "}" | "[" | "]" | ":" | ","; start: number; end: number };

export function getQueryLabTopLevelArgs(operation: QueryLabAssistOperation) {
  if (operation === "findMany") return FIND_MANY_TOP_LEVEL_ARGS;
  if (operation === "findFirst") return FIND_FIRST_TOP_LEVEL_ARGS;
  if (operation === "findUnique") return FIND_UNIQUE_TOP_LEVEL_ARGS;
  return COUNT_TOP_LEVEL_ARGS;
}

export function getQueryLabCompletions(
  source: string,
  cursorOffset: number,
  context: QueryLabAssistContext,
): QueryLabCompletion[] {
  const model = findModel(context);
  if (!model) return [];

  const queryContext = getQueryContext(source.slice(0, cursorOffset), model, context);
  const existingKeys = currentObjectEntries(source, cursorOffset);

  if (queryContext.kind === "root") {
    return topLevelArgCompletions(context.operation, existingKeys);
  }

  if (queryContext.kind === "topLevelValue") {
    if (queryContext.key === "where") return whereFieldCompletions(queryContext.model, existingKeys);
    if (queryContext.key === "select") return selectFieldCompletions(queryContext.model, existingKeys);
    if (queryContext.key === "include") return includeFieldCompletions(queryContext.model, existingKeys);
    if (queryContext.key === "orderBy") return orderByFieldCompletions(queryContext.model, existingKeys);
  }

  if (queryContext.kind === "where") {
    return whereFieldCompletions(queryContext.model, existingKeys);
  }

  if (queryContext.kind === "fieldFilter") {
    if (queryContext.field.kind === "object") {
      return relationFilterCompletions(queryContext.field, existingKeys);
    }
    return operatorCompletions(queryContext.field, existingKeys);
  }

  if (queryContext.kind === "fieldValue") {
    return enumValueCompletions(queryContext.field);
  }

  if (queryContext.kind === "relationFilter") {
    return whereFieldCompletions(queryContext.model, existingKeys);
  }

  if (queryContext.kind === "select") {
    return selectFieldCompletions(queryContext.model, existingKeys);
  }

  if (queryContext.kind === "include") {
    return includeFieldCompletions(queryContext.model, existingKeys);
  }

  if (queryContext.kind === "relationArgs") {
    return nestedRelationArgCompletions(existingKeys);
  }

  if (queryContext.kind === "orderBy") {
    return orderByFieldCompletions(queryContext.model, existingKeys);
  }

  if (queryContext.kind === "sortDirection") {
    return literalCompletions(["asc", "desc"], "Sort direction");
  }

  return [];
}

export function getQueryLabEditorDiagnostics(
  source: string,
  context: QueryLabAssistContext,
): QueryLabEditorDiagnostic[] {
  const diagnostics: QueryLabEditorDiagnostic[] = [];
  const model = findModel(context);
  if (!model) return diagnostics;

  const unmatched = findUnmatchedBracket(source);
  if (unmatched) return [unmatched];

  const objectRanges = collectObjectRanges(source);
  const rootRange = objectRanges[0];
  if (!rootRange) {
    const trimmed = source.trim();
    if (trimmed.length > 0) {
      diagnostics.push({
        message: "Args Mode source must be an object literal.",
        startOffset: 0,
        endOffset: source.length,
      });
    }
    return diagnostics;
  }

  const allowedTopLevelArgs = new Set(getQueryLabTopLevelArgs(context.operation));
  for (const entry of readObjectEntries(source, rootRange.start + 1, rootRange.end)) {
    if (!allowedTopLevelArgs.has(entry.key)) {
      diagnostics.push({
        message: `Unsupported Query Lab ${context.operation} arg: ${entry.key}.`,
        startOffset: entry.start,
        endOffset: entry.end,
      });
    }
  }

  addMetadataDiagnostics(source, model, context, diagnostics);

  return diagnostics;
}

function getQueryContext(
  sourceBeforeCursor: string,
  model: QueryLabAssistModel,
  context: QueryLabAssistContext,
): QueryContext {
  const tokens = tokenize(sourceBeforeCursor);
  const frames = framesForTokens(tokens);
  const currentFrame = frames.at(-1);
  const path = frames
    .filter((frame) => frame.kind === "object" || frame.kind === "array")
    .map((frame) => frame.parentKey)
    .filter((key): key is string => Boolean(key));
  if (!currentFrame) return { kind: "root", model };

  if (currentFrame.kind === "array") {
    const modelForPath = resolveModelForPath(model, context.models, path);
    const field = fieldForPath(model, context.models, path);
    if (field && path.includes("where")) {
      return { kind: "fieldValue", field, model: modelForPath ?? model };
    }
    return { kind: "root", model };
  }

  const expectingValueForKey = currentFrame.key;
  const completedPath = expectingValueForKey ? [...path, expectingValueForKey] : path;

  const modelForPath = resolveModelForPath(model, context.models, completedPath);
  const field = fieldForPath(model, context.models, completedPath);
  const parentContext = classifyPath(path);
  const currentContext = classifyPath(completedPath);

  if (currentContext === "root") return { kind: "root", model };
  if (expectingValueForKey && path.length === 0) return { kind: "topLevelValue", key: expectingValueForKey, model };

  if (field && path.includes("where") && path.at(-1) === field.name && !expectingValueForKey) {
    return { kind: "fieldFilter", field, model: modelForPath ?? model };
  }

  if (
    field &&
    path.includes("where") &&
    expectingValueForKey &&
    SCALAR_FILTER_OPERATORS.includes(expectingValueForKey)
  ) {
    return { kind: "fieldValue", field, model: modelForPath ?? model };
  }

  if (field && currentContext === "fieldValue") {
    return { kind: "fieldValue", field, model: modelForPath ?? model };
  }
  if (field && currentContext === "fieldFilter") {
    return { kind: "fieldFilter", field, model: modelForPath ?? model };
  }

  if (parentContext === "orderBy" && expectingValueForKey) {
    return { kind: "sortDirection", model: modelForPath ?? model };
  }

  if (currentContext === "where") return { kind: "where", model: modelForPath ?? model };
  if (currentContext === "select") return { kind: "select", model: modelForPath ?? model };
  if (currentContext === "include") return { kind: "include", model: modelForPath ?? model };
  if (currentContext === "relationArgs") return { kind: "relationArgs", model: modelForPath ?? model };
  if (currentContext === "relationFilter") return { kind: "relationFilter", model: modelForPath ?? model };
  if (currentContext === "orderBy") return { kind: "orderBy", model: modelForPath ?? model };

  return { kind: "root", model };
}

function classifyPath(path: string[]) {
  if (path.length === 0) return "root";
  const last = path.at(-1);
  if (last === "where") return "where";
  if (last === "select") return "select";
  if (last === "include") return "include";
  if (last === "orderBy") return "orderBy";

  const previous = path.at(-2);
  if (previous === "where") return "fieldValue";
  if (previous === "select") return "fieldValue";
  if (previous === "include") return "relationArgs";
  if (previous === "orderBy") return "fieldValue";

  if (path.some((item) => ["is", "isNot", "some", "every", "none"].includes(item))) {
    return "relationFilter";
  }

  if (path.some((item) => item === "where")) {
    if (previous && SCALAR_FILTER_OPERATORS.includes(previous)) return "fieldValue";
    return "fieldFilter";
  }

  if (path.some((item) => item === "select")) return "select";
  if (path.some((item) => item === "include")) return "include";
  if (path.some((item) => item === "orderBy")) return "orderBy";
  return "root";
}

function framesForTokens(tokens: Token[]) {
  const frames: Frame[] = [];
  let pendingKey: string | undefined;
  let expectingValue = false;

  for (const token of tokens) {
    if (token.kind === "word") {
      if (expectingValue) {
        expectingValue = false;
      } else {
        pendingKey = token.value;
      }
      continue;
    }

    if (token.value === ":") {
      const current = frames.at(-1);
      if (current?.kind === "object" && pendingKey) {
        current.key = pendingKey;
        current.entries.add(pendingKey);
      }
      pendingKey = undefined;
      expectingValue = true;
      continue;
    }

    if (token.value === "{" || token.value === "[") {
      const parent = frames.at(-1);
      const frameKey =
        expectingValue && parent?.kind === "object" ? parent.key : parent?.key;
      frames.push({
        kind: token.value === "{" ? "object" : "array",
        key: undefined,
        parentKey: frameKey,
        ...(token.value === "{" ? { entries: new Set<string>() } : {}),
      } as Frame);
      if (parent?.kind === "object" && expectingValue) parent.key = undefined;
      pendingKey = undefined;
      expectingValue = false;
      continue;
    }

    if (token.value === "}" || token.value === "]") {
      frames.pop();
      pendingKey = undefined;
      expectingValue = false;
      continue;
    }

    if (token.value === ",") {
      const current = frames.at(-1);
      if (current?.kind === "object") current.key = undefined;
      pendingKey = undefined;
      expectingValue = false;
    }
  }

  return frames;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (/\s/.test(char)) continue;
    if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index);
      if (index === -1) break;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    if (isPunctuation(char)) {
      tokens.push({ kind: "punct", value: char, start: index, end: index + 1 });
      continue;
    }
    if (char === "\"" || char === "'") {
      const token = readQuotedToken(source, index, char);
      tokens.push(token);
      index = token.end - 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[\w$]/.test(source[index])) index += 1;
      tokens.push({ kind: "word", value: source.slice(start, index), start, end: index });
      index -= 1;
    }
  }
  return tokens;
}

function readQuotedToken(source: string, start: number, quote: string): Token {
  let index = start + 1;
  let value = "";
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      value += source[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (char === quote) break;
    value += char;
    index += 1;
  }
  return { kind: "word", value, start, end: Math.min(index + 1, source.length) };
}

function isPunctuation(value: string): value is Token extends infer T
  ? T extends { kind: "punct"; value: infer P }
    ? P
    : never
  : never {
  return ["{", "}", "[", "]", ":", ","].includes(value);
}

function currentObjectEntries(source: string, cursorOffset: number) {
  const tokens = tokenize(source.slice(0, cursorOffset));
  const frame = framesForTokens(tokens).at(-1);
  return frame?.kind === "object" ? frame.entries : new Set<string>();
}

function topLevelArgCompletions(
  operation: QueryLabAssistOperation,
  existingKeys: Set<string>,
) {
  return getQueryLabTopLevelArgs(operation)
    .filter((arg) => !existingKeys.has(arg))
    .map((arg) => completion(arg, `${arg}: `, "arg", `${operation} arg`));
}

function nestedRelationArgCompletions(existingKeys: Set<string>) {
  return NESTED_RELATION_ARGS.filter((arg) => !existingKeys.has(arg)).map((arg) =>
    completion(arg, `${arg}: `, "arg", "Nested relation arg"),
  );
}

function whereFieldCompletions(model: QueryLabAssistModel, existingKeys: Set<string>) {
  const fields = model.fields
    .filter((field) => ["scalar", "enum", "object"].includes(field.kind))
    .filter((field) => !existingKeys.has(field.name))
    .map((field) =>
      completion(
        field.name,
        `${field.name}: `,
        field.kind === "object" ? "relation" : "field",
        `${model.name}.${field.name}`,
      ),
    );
  const logical = WHERE_LOGICAL_KEYS.filter((key) => !existingKeys.has(key)).map((key) =>
    completion(key, `${key}: `, "operator", "Logical where operator"),
  );
  return [...fields, ...logical];
}

function selectFieldCompletions(model: QueryLabAssistModel, existingKeys: Set<string>) {
  return model.fields
    .filter((field) => ["scalar", "enum", "object"].includes(field.kind))
    .filter((field) => !existingKeys.has(field.name))
    .map((field) =>
      completion(
        field.name,
        `${field.name}: true`,
        field.kind === "object" ? "relation" : "field",
        `${model.name}.${field.name}`,
      ),
    );
}

function includeFieldCompletions(model: QueryLabAssistModel, existingKeys: Set<string>) {
  return model.fields
    .filter((field) => field.kind === "object")
    .filter((field) => !existingKeys.has(field.name))
    .map((field) => completion(field.name, `${field.name}: true`, "relation", field.type));
}

function orderByFieldCompletions(model: QueryLabAssistModel, existingKeys: Set<string>) {
  return model.fields
    .filter((field) => ["scalar", "enum", "object"].includes(field.kind))
    .filter((field) => !existingKeys.has(field.name))
    .map((field) =>
      completion(
        field.name,
        field.kind === "object" ? `${field.name}: { ` : `${field.name}: "asc"`,
        field.kind === "object" ? "relation" : "field",
        `${model.name}.${field.name}`,
      ),
    );
}

function operatorCompletions(field: QueryLabAssistField, existingKeys: Set<string>) {
  if (field.kind === "object") return relationFilterCompletions(field, existingKeys);
  return SCALAR_FILTER_OPERATORS.filter((operator) => supportsOperator(field, operator))
    .filter((operator) => !existingKeys.has(operator))
    .map((operator) => completion(operator, `${operator}: `, "operator", `${field.type} filter`));
}

function relationFilterCompletions(field: QueryLabAssistField, existingKeys: Set<string>) {
  const operators = field.isList ? ["some", "every", "none"] : RELATION_FILTER_OPERATORS;
  return operators
    .filter((operator) => !existingKeys.has(operator))
    .map((operator) => completion(operator, `${operator}: `, "operator", `${field.type} relation filter`));
}

function enumValueCompletions(field: QueryLabAssistField) {
  if (field.kind !== "enum") return [];
  return literalCompletions(field.enumValues ?? [], field.type);
}

function literalCompletions(values: string[], detail: string) {
  return values.map((value) => completion(value, `"${value}"`, "literal", detail));
}

function completion(
  label: string,
  insertText: string,
  kind: QueryLabCompletionKind,
  detail: string,
): QueryLabCompletion {
  return { label, insertText, kind, detail };
}

function supportsOperator(field: QueryLabAssistField, operator: string) {
  if (["has", "hasEvery", "hasSome", "isEmpty"].includes(operator)) return field.isList;
  if (["contains", "startsWith", "endsWith"].includes(operator)) {
    return field.type === "String" || field.isList;
  }
  return true;
}

function findModel(context: QueryLabAssistContext): QueryLabAssistModel | null {
  return context.models.find((model) => model.name === context.modelName) ?? null;
}

function resolveModelForPath(
  rootModel: QueryLabAssistModel,
  models: QueryLabAssistModel[],
  path: string[],
): QueryLabAssistModel | undefined {
  let currentModel: QueryLabAssistModel | undefined = rootModel;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (["where", "select", "include", "orderBy"].includes(segment)) continue;
    if ([...SCALAR_FILTER_OPERATORS, ...RELATION_FILTER_OPERATORS, ...WHERE_LOGICAL_KEYS].includes(segment)) continue;
    const field: QueryLabAssistField | undefined = currentModel
      ? findFieldByName(currentModel, segment)
      : undefined;
    if (!field) continue;
    if (field.kind === "object") {
      const relatedModel: QueryLabAssistModel | undefined = findModelByName(models, field.type);
      if (relatedModel) currentModel = relatedModel;
    }
  }
  return currentModel;
}

function fieldForPath(
  rootModel: QueryLabAssistModel,
  models: QueryLabAssistModel[],
  path: string[],
): QueryLabAssistField | undefined {
  let currentModel: QueryLabAssistModel | undefined = rootModel;
  let lastField: QueryLabAssistField | undefined;
  for (const segment of path) {
    if (["where", "select", "include", "orderBy"].includes(segment)) continue;
    if ([...SCALAR_FILTER_OPERATORS, ...RELATION_FILTER_OPERATORS, ...WHERE_LOGICAL_KEYS].includes(segment)) continue;
    const field: QueryLabAssistField | undefined = currentModel
      ? findFieldByName(currentModel, segment)
      : undefined;
    if (!field) continue;
    lastField = field;
    if (field.kind === "object") {
      currentModel = findModelByName(models, field.type) ?? currentModel;
    }
  }
  return lastField;
}

function findUnmatchedBracket(source: string): QueryLabEditorDiagnostic | null {
  const stack: Array<{ char: string; offset: number }> = [];
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push({ char, offset: index });
      continue;
    }
    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      const last = stack.pop();
      if (!last || last.char !== expected) {
        return {
          message: `Unexpected "${char}" in Args Mode source.`,
          startOffset: index,
          endOffset: index + 1,
        };
      }
    }
  }

  const unclosed = stack.at(-1);
  if (!unclosed) return null;
  return {
    message: `Unclosed "${unclosed.char}" in Args Mode source.`,
    startOffset: unclosed.offset,
    endOffset: unclosed.offset + 1,
  };
}

function collectObjectRanges(source: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  const stack: number[] = [];
  for (const token of tokenize(source)) {
    if (token.kind !== "punct") continue;
    if (token.value === "{") stack.push(token.start);
    if (token.value === "}") {
      const start = stack.pop();
      if (start !== undefined) ranges.push({ start, end: token.start });
    }
  }
  return ranges.sort((left, right) => left.start - right.start);
}

function readObjectEntries(source: string, start: number, end: number) {
  const entries: Array<{ key: string; start: number; end: number }> = [];
  const tokens = tokenize(source.slice(start, end)).map((token) => ({
    ...token,
    start: token.start + start,
    end: token.end + start,
  }));
  let depth = 0;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token.kind === "punct" && (token.value === "{" || token.value === "[")) depth += 1;
    if (token.kind === "punct" && (token.value === "}" || token.value === "]")) depth -= 1;
    if (depth === 0 && token.kind === "word" && next?.kind === "punct" && next.value === ":") {
      entries.push({ key: token.value, start: token.start, end: token.end });
    }
  }
  return entries;
}

function addMetadataDiagnostics(
  source: string,
  model: QueryLabAssistModel,
  context: QueryLabAssistContext,
  diagnostics: QueryLabEditorDiagnostic[],
) {
  const tokens = tokenize(source);
  const frames: Frame[] = [];
  let pendingKey: Token | null = null;
  let expectingValue = false;

  for (const token of tokens) {
    if (token.kind === "word") {
      if (expectingValue) {
        expectingValue = false;
      } else {
        pendingKey = token;
      }
      continue;
    }
    if (token.value === ":") {
      const path = frames
        .map((frame) => frame.parentKey)
        .filter((key): key is string => Boolean(key));
      if (pendingKey) {
        const error = validateKeyForPath(model, context.models, path, pendingKey.value, context.operation);
        if (error) {
          diagnostics.push({
            message: error,
            startOffset: pendingKey.start,
            endOffset: pendingKey.end,
          });
        }
        const current = frames.at(-1);
        if (current?.kind === "object") current.key = pendingKey.value;
      }
      pendingKey = null;
      expectingValue = true;
      continue;
    }
    if (token.value === "{" || token.value === "[") {
      const parent = frames.at(-1);
      const frameKey =
        expectingValue && parent?.kind === "object" ? parent.key : parent?.key;
      frames.push({
        kind: token.value === "{" ? "object" : "array",
        key: undefined,
        parentKey: frameKey,
        ...(token.value === "{" ? { entries: new Set<string>() } : {}),
      } as Frame);
      if (parent?.kind === "object" && expectingValue) parent.key = undefined;
      expectingValue = false;
      continue;
    }
    if (token.value === "}" || token.value === "]") {
      frames.pop();
      expectingValue = false;
      continue;
    }
    if (token.value === ",") {
      const current = frames.at(-1);
      if (current?.kind === "object") current.key = undefined;
      pendingKey = null;
      expectingValue = false;
    }
  }
}

function validateKeyForPath(
  rootModel: QueryLabAssistModel,
  models: QueryLabAssistModel[],
  path: string[],
  key: string,
  operation: QueryLabAssistOperation,
) {
  if (path.length === 0) {
    return getQueryLabTopLevelArgs(operation).includes(key)
      ? undefined
      : `Unsupported Query Lab ${operation} arg: ${key}.`;
  }

  const classification = classifyPath([...path, key]);
  const parentClassification = classifyPath(path);
  const pathModel = resolveModelForPath(rootModel, models, path) ?? rootModel;

  if (parentClassification === "where") {
    if (WHERE_LOGICAL_KEYS.includes(key)) return undefined;
    return findSupportedField(pathModel, key) ? undefined : `Unknown field ${[...path, key].join(".")} on model ${pathModel.name}.`;
  }
  if (parentClassification === "select") {
    return findSupportedField(pathModel, key) ? undefined : `Unknown field ${[...path, key].join(".")} on model ${pathModel.name}.`;
  }
  if (parentClassification === "include") {
    const field = pathModel.fields.find((candidate) => candidate.name === key);
    return field?.kind === "object" ? undefined : `${[...path, key].join(".")} must reference a relation field.`;
  }
  if (parentClassification === "orderBy") {
    return findSupportedField(pathModel, key) ? undefined : `Unknown field ${[...path, key].join(".")} on model ${pathModel.name}.`;
  }

  const field = fieldForPath(rootModel, models, path);
  if (classification === "fieldFilter" && field) {
    if (field.kind === "object") {
      const operators = field.isList ? ["some", "every", "none"] : RELATION_FILTER_OPERATORS;
      return operators.includes(key) ? undefined : `Unsupported relation filter ${[...path, key].join(".")}.`;
    }
    return SCALAR_FILTER_OPERATORS.includes(key) ? undefined : `Unsupported field filter ${[...path, key].join(".")}.`;
  }

  if (parentClassification === "relationArgs") {
    return NESTED_RELATION_ARGS.includes(key) ? undefined : `Unsupported nested relation arg ${[...path, key].join(".")}.`;
  }

  return undefined;
}

function findSupportedField(model: QueryLabAssistModel, fieldName: string) {
  return model.fields.find(
    (field) =>
      field.name === fieldName && ["scalar", "enum", "object"].includes(field.kind),
  );
}

function findModelByName(
  models: QueryLabAssistModel[],
  modelName: string,
): QueryLabAssistModel | undefined {
  return models.find((candidate) => candidate.name === modelName);
}

function findFieldByName(
  model: QueryLabAssistModel,
  fieldName: string,
): QueryLabAssistField | undefined {
  return model.fields.find((candidate) => candidate.name === fieldName);
}
