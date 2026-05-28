import type { PrismaMetadata, PrismaModelMetadata, PrismaFieldMetadata } from "./metadata.js";
import type { QueryLabOperation } from "./query-lab-validation.js";

const LARGE_SKIP_THRESHOLD = 1_000;

export type QueryLabWarningCode =
  | "FIND_MANY_DEFAULT_TAKE"
  | "BROAD_SCALAR_SELECT"
  | "LARGE_SKIP"
  | "UNBOUNDED_INCLUDE"
  | "NON_UNIQUE_SORT"
  | "NON_UNIQUE_FILTER";

export type QueryLabWarning = {
  code: QueryLabWarningCode;
  path: string;
  message: string;
};

type QueryLabArgsNormalization = {
  path: string;
  action: "default" | "cap";
  reason: string;
  value: unknown;
};

type WarningContext = {
  modelByName: Map<string, PrismaModelMetadata>;
  warnings: QueryLabWarning[];
};

export function analyzeQueryLabWarnings({
  metadata,
  model,
  operation,
  args,
  normalization,
}: {
  metadata: PrismaMetadata;
  model: PrismaModelMetadata;
  operation: QueryLabOperation;
  args: Record<string, unknown>;
  normalization: QueryLabArgsNormalization[];
}): QueryLabWarning[] {
  const context: WarningContext = {
    modelByName: new Map(metadata.models.map((candidate) => [candidate.name, candidate])),
    warnings: [],
  };

  if (
    operation === "findMany" &&
    normalization.some(
      (item) =>
        item.path === "take" &&
        item.action === "default" &&
        item.reason === "findManySafetyTake",
    )
  ) {
    context.warnings.push({
      code: "FIND_MANY_DEFAULT_TAKE",
      path: "take",
      message:
        "findMany did not include an explicit take, so Query Lab applied the default preview cap.",
    });
  }

  if (operation !== "count") {
    analyzeBroadScalarSelect(context, model, args, []);
    analyzeIncludeFanout(context, model, args.include, ["include"]);
  }

  analyzeLargeSkip(context, args.skip, ["skip"]);
  analyzeWhere(context, model, args.where, ["where"]);
  analyzeOrderBy(context, model, args.orderBy, ["orderBy"]);

  return dedupeWarnings(context.warnings);
}

function analyzeBroadScalarSelect(
  context: WarningContext,
  model: PrismaModelMetadata,
  args: Record<string, unknown>,
  path: string[],
) {
  const scalarFields = model.fields.filter(isScalarResultField);
  if (scalarFields.length <= 1) return;

  if (args.select === undefined) {
    context.warnings.push({
      code: "BROAD_SCALAR_SELECT",
      path: formatPath(path.length > 0 ? path : ["select"]),
      message: `${model.name} returns all ${scalarFields.length} scalar fields by default. Add a narrower select to reduce payload size.`,
    });
    return;
  }

  const select = args.select;
  if (!isRecord(select)) return;

  const selectsEveryScalar = scalarFields.every((field) => select[field.name] === true);
  if (selectsEveryScalar) {
    context.warnings.push({
      code: "BROAD_SCALAR_SELECT",
      path: formatPath([...path, "select"]),
      message: `${model.name} selects all ${scalarFields.length} scalar fields. A narrower select can reduce payload size.`,
    });
  }
}

function analyzeLargeSkip(context: WarningContext, value: unknown, path: string[]) {
  if (typeof value !== "number" || value <= LARGE_SKIP_THRESHOLD) return;
  context.warnings.push({
    code: "LARGE_SKIP",
    path: formatPath(path),
    message: `skip is ${value}. Large offset pagination can become slow; prefer a cursor or a more selective filter when possible.`,
  });
}

function analyzeIncludeFanout(
  context: WarningContext,
  model: PrismaModelMetadata,
  value: unknown,
  path: string[],
) {
  if (!isRecord(value)) return;

  for (const [key, includeValue] of Object.entries(value)) {
    if (includeValue === false) continue;

    const field = findField(model, key);
    if (!field || field.kind !== "object") continue;

    const fieldPath = [...path, key];
    const relatedModel = context.modelByName.get(field.type);
    const nestedArgs = isRecord(includeValue) ? includeValue : null;

    if (field.isList && (!nestedArgs || nestedArgs.take === undefined)) {
      context.warnings.push({
        code: "UNBOUNDED_INCLUDE",
        path: formatPath(fieldPath),
        message: `${formatPath(fieldPath)} includes a list relation without a nested take. Add a nested take to limit relation fanout.`,
      });
    }

    if (relatedModel && nestedArgs) {
      analyzeBroadScalarSelect(context, relatedModel, nestedArgs, fieldPath);
      analyzeLargeSkip(context, nestedArgs.skip, [...fieldPath, "skip"]);
      analyzeWhere(context, relatedModel, nestedArgs.where, [...fieldPath, "where"]);
      analyzeOrderBy(context, relatedModel, nestedArgs.orderBy, [...fieldPath, "orderBy"]);
      analyzeIncludeFanout(context, relatedModel, nestedArgs.include, [...fieldPath, "include"]);
    }
  }
}

function analyzeWhere(
  context: WarningContext,
  model: PrismaModelMetadata,
  value: unknown,
  path: string[],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => analyzeWhere(context, model, item, [...path, String(index)]));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, filterValue] of Object.entries(value)) {
    const fieldPath = [...path, key];
    if (key === "AND" || key === "OR" || key === "NOT") {
      analyzeWhere(context, model, filterValue, fieldPath);
      continue;
    }

    const field = findField(model, key);
    if (!field) continue;

    if (field.kind === "scalar" || field.kind === "enum") {
      if (!isKnownUniqueField(field)) {
        context.warnings.push({
          code: "NON_UNIQUE_FILTER",
          path: formatPath(fieldPath),
          message: `${formatPath(fieldPath)} filters on ${model.name}.${field.name}, which is not marked id or unique in Prisma metadata. This may scan more rows than expected.`,
        });
      }
      continue;
    }

    if (field.kind === "object") {
      const relatedModel = context.modelByName.get(field.type);
      if (!relatedModel || !isRecord(filterValue)) continue;
      for (const [operator, nestedWhere] of Object.entries(filterValue)) {
        analyzeWhere(context, relatedModel, nestedWhere, [...fieldPath, operator]);
      }
    }
  }
}

function analyzeOrderBy(
  context: WarningContext,
  model: PrismaModelMetadata,
  value: unknown,
  path: string[],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => analyzeOrderBy(context, model, item, [...path, String(index)]));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, direction] of Object.entries(value)) {
    const field = findField(model, key);
    if (!field) continue;

    const fieldPath = [...path, key];
    if (field.kind === "scalar" || field.kind === "enum") {
      if (!isKnownUniqueField(field)) {
        context.warnings.push({
          code: "NON_UNIQUE_SORT",
          path: formatPath(fieldPath),
          message: `${formatPath(fieldPath)} sorts by ${model.name}.${field.name}, which is not marked id or unique in Prisma metadata. Sorting on non-unique fields may require extra database work.`,
        });
      }
      continue;
    }

    if (field.kind === "object" && isRecord(direction)) {
      const relatedModel = context.modelByName.get(field.type);
      if (relatedModel) analyzeOrderBy(context, relatedModel, direction, fieldPath);
    }
  }
}

function dedupeWarnings(warnings: QueryLabWarning[]) {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isScalarResultField(field: PrismaFieldMetadata) {
  return field.kind === "scalar" || field.kind === "enum";
}

function isKnownUniqueField(field: PrismaFieldMetadata) {
  return field.isId || field.isUnique;
}

function findField(model: PrismaModelMetadata, name: string) {
  return model.fields.find((field) => field.name === name);
}

function formatPath(path: string[]) {
  return path.join(".");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
