import type { PrismaMetadata, PrismaModelMetadata, PrismaFieldMetadata } from "./metadata.js";

export type QueryLabOperation = "findMany" | "findFirst" | "findUnique" | "count";

export type QueryLabArgsValidationResult =
  | { args: Record<string, unknown> }
  | { error: string };

const FIND_MANY_TOP_LEVEL_KEYS = new Set([
  "where",
  "select",
  "include",
  "orderBy",
  "skip",
  "take",
]);
const FIND_FIRST_TOP_LEVEL_KEYS = new Set([
  "where",
  "select",
  "include",
  "orderBy",
  "skip",
]);
const FIND_UNIQUE_TOP_LEVEL_KEYS = new Set(["where", "select", "include"]);
const COUNT_TOP_LEVEL_KEYS = new Set(["where"]);

const WHERE_LOGICAL_KEYS = new Set(["AND", "OR", "NOT"]);
const SCALAR_FILTER_OPERATORS = new Set([
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
  "mode",
  "has",
  "hasEvery",
  "hasSome",
  "isEmpty",
]);

export function validateQueryLabArgs(
  metadata: PrismaMetadata,
  model: PrismaModelMetadata,
  operation: QueryLabOperation,
  args: Record<string, unknown>,
): QueryLabArgsValidationResult {
  const modelByName = new Map(metadata.models.map((candidate) => [candidate.name, candidate]));
  const context: ValidationContext = {
    modelByName,
    path: [],
  };
  const topLevelKeys = topLevelKeysForOperation(operation);

  for (const key of Object.keys(args)) {
    if (!topLevelKeys.has(key)) {
      return {
        error: `Unsupported Query Lab ${operation} arg: ${key}. Supported args are ${[
          ...topLevelKeys,
        ].join(", ")}.`,
      };
    }
  }

  const whereError = validateOptionalObject(context, model, args.where, "where", validateWhere);
  if (whereError) return { error: whereError };

  if (topLevelKeys.has("select")) {
    const selectError = validateOptionalObject(
      context,
      model,
      args.select,
      "select",
      validateSelect,
    );
    if (selectError) return { error: selectError };
  }

  if (topLevelKeys.has("include")) {
    const includeError = validateOptionalObject(
      context,
      model,
      args.include,
      "include",
      validateInclude,
    );
    if (includeError) return { error: includeError };
  }

  if (topLevelKeys.has("orderBy")) {
    const orderByError = validateOrderByArg(context, model, args.orderBy, ["orderBy"]);
    if (orderByError) return { error: orderByError };
  }

  if (topLevelKeys.has("skip")) {
    const skipError = validateIntegerArg(args.skip, "skip");
    if (skipError) return { error: skipError };
  }

  if (topLevelKeys.has("take")) {
    const takeError = validateIntegerArg(args.take, "take");
    if (takeError) return { error: takeError };
  }

  return { args };
}

function topLevelKeysForOperation(operation: QueryLabOperation) {
  if (operation === "findMany") return FIND_MANY_TOP_LEVEL_KEYS;
  if (operation === "findFirst") return FIND_FIRST_TOP_LEVEL_KEYS;
  if (operation === "findUnique") return FIND_UNIQUE_TOP_LEVEL_KEYS;
  return COUNT_TOP_LEVEL_KEYS;
}

type ValidationContext = {
  modelByName: Map<string, PrismaModelMetadata>;
  path: string[];
};

type ObjectValidator = (
  context: ValidationContext,
  model: PrismaModelMetadata,
  value: Record<string, unknown>,
) => string | undefined;

function validateOptionalObject(
  context: ValidationContext,
  model: PrismaModelMetadata,
  value: unknown,
  key: string,
  validator: ObjectValidator,
) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return `${formatPath([...context.path, key])} must be an object.`;
  return validator({ ...context, path: [...context.path, key] }, model, value);
}

function validateWhere(
  context: ValidationContext,
  model: PrismaModelMetadata,
  where: Record<string, unknown>,
): string | undefined {
  for (const [key, value] of Object.entries(where)) {
    const path = [...context.path, key];

    if (WHERE_LOGICAL_KEYS.has(key)) {
      const error = validateLogicalWhere(context, model, value, path);
      if (error) return error;
      continue;
    }

    const field = findField(model, key);
    if (!field) return `Unknown field ${formatPath(path)} on model ${model.name}.`;

    if (field.kind === "scalar" || field.kind === "enum") {
      const error = validateFieldWhereValue(context, field, value, path);
      if (error) return error;
      continue;
    }

    if (field.kind === "object") {
      const relatedModel = context.modelByName.get(field.type);
      if (!relatedModel) {
        return `Cannot validate relation filter ${formatPath(path)} because model ${field.type} was not found.`;
      }
      const error = validateRelationWhere(context, relatedModel, value, path);
      if (error) return error;
      continue;
    }

    return `Field ${formatPath(path)} is not supported in Query Lab where args.`;
  }

  return undefined;
}

function validateLogicalWhere(
  context: ValidationContext,
  model: PrismaModelMetadata,
  value: unknown,
  path: string[],
) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      if (!isRecord(item)) return `${formatPath([...path, String(index)])} must be an object.`;
      const error = validateWhere({ ...context, path: [...path, String(index)] }, model, item);
      if (error) return error;
    }
    return undefined;
  }

  if (!isRecord(value)) return `${formatPath(path)} must be an object or array of objects.`;
  return validateWhere({ ...context, path }, model, value);
}

function validateRelationWhere(
  context: ValidationContext,
  relatedModel: PrismaModelMetadata,
  value: unknown,
  path: string[],
) {
  if (!isRecord(value)) {
    return `${formatPath(path)} relation filters must use an object shape.`;
  }

  const relationOperators = new Set(["is", "isNot", "some", "every", "none"]);
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!relationOperators.has(key)) {
      return `Unsupported relation filter ${formatPath([...path, key])}. Supported relation filters are is, isNot, some, every, none.`;
    }
    if (nestedValue !== null && !isRecord(nestedValue)) {
      return `${formatPath([...path, key])} must be an object or null.`;
    }
    if (isRecord(nestedValue)) {
      const error = validateWhere({ ...context, path: [...path, key] }, relatedModel, nestedValue);
      if (error) return error;
    }
  }

  return undefined;
}

function validateFieldWhereValue(
  context: ValidationContext,
  field: PrismaFieldMetadata,
  value: unknown,
  path: string[],
) {
  if (field.kind === "enum") {
    const enumError = validateEnumValue(field, value, path);
    if (enumError) return enumError;
  }

  if (!isPlainFilterObject(value)) {
    return isRecord(value) ? `Unsupported field filter ${formatPath(path)}.` : undefined;
  }

  for (const [operator, operatorValue] of Object.entries(value)) {
    const operatorPath = [...path, operator];
    if (!SCALAR_FILTER_OPERATORS.has(operator)) {
      return `Unsupported field filter ${formatPath(operatorPath)}.`;
    }
    if (field.kind === "enum") {
      const enumError = validateEnumValue(field, operatorValue, operatorPath);
      if (enumError) return enumError;
    }
    if ((operator === "in" || operator === "notIn" || operator === "hasEvery" || operator === "hasSome") && !Array.isArray(operatorValue)) {
      return `${formatPath(operatorPath)} must be an array.`;
    }
  }

  return undefined;
}

function validateEnumValue(
  field: PrismaFieldMetadata,
  value: unknown,
  path: string[],
): string | undefined {
  if (field.enumValues.length === 0) return undefined;

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const error = validateEnumLiteral(field, item, [...path, String(index)]);
      if (error) return error;
    }
    return undefined;
  }

  if (isPlainFilterObject(value)) {
    for (const [operator, operatorValue] of Object.entries(value)) {
      const error = validateEnumValue(field, operatorValue, [...path, operator]);
      if (error) return error;
    }
    return undefined;
  }

  return validateEnumLiteral(field, value, path);
}

function validateEnumLiteral(field: PrismaFieldMetadata, value: unknown, path: string[]) {
  if (value === null) return undefined;
  if (typeof value !== "string") {
    return `${formatPath(path)} must be one of ${field.enumValues.join(", ")}.`;
  }
  if (!field.enumValues.includes(value)) {
    return `Invalid enum value for ${formatPath(path)}: ${value}. Expected one of ${field.enumValues.join(", ")}.`;
  }
  return undefined;
}

function validateSelect(
  context: ValidationContext,
  model: PrismaModelMetadata,
  select: Record<string, unknown>,
): string | undefined {
  for (const [key, value] of Object.entries(select)) {
    const path = [...context.path, key];
    const field = findField(model, key);
    if (!field) return `Unknown field ${formatPath(path)} on model ${model.name}.`;

    if (value === true || value === false) continue;

    if (field.kind !== "object") {
      return `${formatPath(path)} must be true or false for scalar and enum fields.`;
    }

    const relatedModel = context.modelByName.get(field.type);
    if (!relatedModel) {
      return `Cannot validate nested select ${formatPath(path)} because model ${field.type} was not found.`;
    }
    const error = validateNestedRelationArgs(context, relatedModel, value, path);
    if (error) return error;
  }

  return undefined;
}

function validateInclude(
  context: ValidationContext,
  model: PrismaModelMetadata,
  include: Record<string, unknown>,
): string | undefined {
  for (const [key, value] of Object.entries(include)) {
    const path = [...context.path, key];
    const field = findField(model, key);
    if (!field) return `Unknown field ${formatPath(path)} on model ${model.name}.`;
    if (field.kind !== "object") {
      return `${formatPath(path)} must reference a relation field.`;
    }
    if (value === true || value === false) continue;

    const relatedModel = context.modelByName.get(field.type);
    if (!relatedModel) {
      return `Cannot validate nested include ${formatPath(path)} because model ${field.type} was not found.`;
    }
    const error = validateNestedRelationArgs(context, relatedModel, value, path);
    if (error) return error;
  }

  return undefined;
}

function validateNestedRelationArgs(
  context: ValidationContext,
  model: PrismaModelMetadata,
  value: unknown,
  path: string[],
) {
  if (!isRecord(value)) return `${formatPath(path)} must be a boolean or nested args object.`;

  for (const key of Object.keys(value)) {
    if (!FIND_MANY_TOP_LEVEL_KEYS.has(key)) {
      return `Unsupported nested relation arg ${formatPath([...path, key])}.`;
    }
  }

  const nestedContext = { ...context, path };
  return (
    validateOptionalObject(nestedContext, model, value.where, "where", validateWhere) ??
    validateOptionalObject(nestedContext, model, value.select, "select", validateSelect) ??
    validateOptionalObject(nestedContext, model, value.include, "include", validateInclude) ??
    validateOrderByArg(nestedContext, model, value.orderBy, [...path, "orderBy"]) ??
    validateIntegerArg(value.skip, formatPath([...path, "skip"])) ??
    validateIntegerArg(value.take, formatPath([...path, "take"]))
  );
}

function validateOrderByArg(
  context: ValidationContext,
  model: PrismaModelMetadata,
  value: unknown,
  path: string[],
) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const error = validateOrderByObject(context, model, item, [...path, String(index)]);
      if (error) return error;
    }
    return undefined;
  }

  return validateOrderByObject(context, model, value, path);
}

function validateOrderByObject(
  context: ValidationContext,
  model: PrismaModelMetadata,
  value: unknown,
  path: string[],
): string | undefined {
  if (!isRecord(value)) return `${formatPath(path)} must be an object or array of objects.`;

  for (const [key, direction] of Object.entries(value)) {
    const field = findField(model, key);
    const fieldPath = [...path, key];
    if (!field) return `Unknown field ${formatPath(fieldPath)} on model ${model.name}.`;

    if (field.kind === "scalar" || field.kind === "enum") {
      if (direction !== "asc" && direction !== "desc") {
        return `${formatPath(fieldPath)} must be "asc" or "desc".`;
      }
      continue;
    }

    if (field.kind === "object" && isRecord(direction)) {
      const relatedModel = context.modelByName.get(field.type);
      if (!relatedModel) {
        return `Cannot validate nested orderBy ${formatPath(fieldPath)} because model ${field.type} was not found.`;
      }
      const error = validateOrderByObject(context, relatedModel, direction, fieldPath);
      if (error) return error;
      continue;
    }

    return `Field ${formatPath(fieldPath)} is not supported in Query Lab orderBy args.`;
  }

  return undefined;
}

function validateIntegerArg(value: unknown, label: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return `${label} must be a non-negative integer.`;
  }
  return undefined;
}

function findField(model: PrismaModelMetadata, name: string) {
  return model.fields.find((field) => field.name === name);
}

function isPlainFilterObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).some((key) => SCALAR_FILTER_OPERATORS.has(key));
}

function formatPath(path: string[]) {
  return path.join(".");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
