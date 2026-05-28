export type Field = {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
  enumValues?: string[];
  isList: boolean;
  isRequired: boolean;
};

export type Model = {
  name: string;
  fields: Field[];
};

export type PreviewMode = "fields" | "json";
export type QueryLabResultMode = "table" | "json";
export type QueryLabOperation = "findMany" | "findFirst" | "findUnique" | "count";

export const QUERY_LAB_OPERATIONS: QueryLabOperation[] = [
  "findMany",
  "findFirst",
  "findUnique",
  "count",
];

export type QueryLabArgsNormalization =
  | {
      path: string;
      action: "default";
      reason: string;
      value: unknown;
    }
  | {
      path: string;
      action: "cap";
      reason: string;
      originalValue: unknown;
      value: unknown;
    };

export type QueryLabSafetyLimits = {
  maxArgsDepth?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  argsDepth?: number;
  responseSizeBytes?: number;
};

export type QueryLabSqlEvent = {
  query?: string;
  params?: string;
  durationMs?: number;
};

export type QueryLabWarning = {
  code?: string;
  path?: string;
  message: string;
};

export type QueryLabPreviewResponse = {
  model: string;
  operation: QueryLabOperation;
  args: Record<string, unknown>;
  normalizedArgs?: Record<string, unknown>;
  normalization?: QueryLabArgsNormalization[];
  warnings?: QueryLabWarning[];
  safetyLimits?: QueryLabSafetyLimits;
  prismaCall?: string;
  timing?: {
    durationMs?: number;
  };
  sql?: {
    events?: QueryLabSqlEvent[];
  };
  result?: unknown;
  rows?: unknown[];
};

export type QueryLabSqlEventViewModel = {
  label: string;
  durationLabel: string | null;
  query: string | null;
  params: string | null;
};

export type QueryInspectorViewModel = {
  title: string;
  normalizedArgsJson: string;
  prismaCall: string;
  normalizationMessages: string[];
  durationLabel: string;
  safetyLimits: Array<{ label: string; value: string }>;
  warnings: QueryLabWarning[];
  sqlEvents: QueryLabSqlEventViewModel[];
};

export type QueryLabResultViewModel =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "count";
      value: number;
      json: string;
      inspector: QueryInspectorViewModel;
    }
  | {
      kind: "singleMiss";
      operation: "findFirst" | "findUnique";
      json: string;
      inspector: QueryInspectorViewModel;
    }
  | {
      kind: "rows";
      rows: Record<string, unknown>[];
      columns: string[];
      selectedRowIndex: number;
      selectedRow: Record<string, unknown> | null;
      selectedFields: Field[];
      resultJson: string;
      selectedRecordJson: string | null;
      inspector: QueryInspectorViewModel;
    }
  | {
      kind: "jsonOnly";
      json: string;
      inspector: QueryInspectorViewModel;
    };

export type QueryLabResultPresenterInput = {
  preview: QueryLabPreviewResponse | null;
  fallbackOperation: QueryLabOperation;
  selectedModel: Model | null;
  selectedRowIndex: number;
  isLoading?: boolean;
  errorMessage?: string | null;
};

export function createQueryLabResultViewModel({
  preview,
  fallbackOperation,
  selectedModel,
  selectedRowIndex,
  isLoading = false,
  errorMessage = null,
}: QueryLabResultPresenterInput): QueryLabResultViewModel {
  if (isLoading) return { kind: "loading" };
  if (errorMessage) return { kind: "error", message: errorMessage };
  if (!preview) return { kind: "empty" };

  const operation = preview.operation ?? fallbackOperation;
  const result = queryLabPreviewResult(preview);
  const inspector = createQueryInspectorViewModel(preview);

  if (operation === "count" && typeof result === "number") {
    return {
      kind: "count",
      value: result,
      json: formatJsonBlock(result),
      inspector,
    };
  }

  if ((operation === "findFirst" || operation === "findUnique") && result === null) {
    return {
      kind: "singleMiss",
      operation,
      json: formatJsonBlock(result),
      inspector,
    };
  }

  const rows = rowsForQueryLabResult(operation, result);
  const columns = columnsForRows(rows);
  if (columns.length === 0) {
    return {
      kind: "jsonOnly",
      json: formatJsonBlock(result),
      inspector,
    };
  }

  const clampedSelectedRowIndex = clampRowIndex(selectedRowIndex, rows.length);
  const selectedRow = rows[clampedSelectedRowIndex] ?? null;
  return {
    kind: "rows",
    rows,
    columns,
    selectedRowIndex: clampedSelectedRowIndex,
    selectedRow,
    selectedFields: fieldsForRecord(selectedRow, selectedModel),
    resultJson: formatJsonBlock(result),
    selectedRecordJson: selectedRow ? formatJsonPreview(selectedRow) : null,
    inspector,
  };
}

export function formatValue(value: unknown) {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }
  return String(value);
}

export function getCellTone(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" || typeof value === "bigint") return "number";
  if (typeof value === "object") return "json";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return "date";
  return "text";
}

export function formatFieldType(field: Field) {
  const listSuffix = field.isList ? "[]" : "";
  const requiredSuffix = field.isRequired ? "" : "?";
  return `${field.type}${listSuffix}${requiredSuffix}`;
}

export function formatJsonPreview(row: Record<string, unknown>) {
  return JSON.stringify(toStableJsonValue(row), null, 2);
}

export function formatJsonBlock(value: unknown) {
  return JSON.stringify(toStableJsonValue(value), null, 2);
}

export function formatDuration(durationMs: unknown) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return "Not available";
  }

  return `${durationMs.toFixed(durationMs < 10 ? 2 : 1)} ms`;
}

export function formatBytes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not available";
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
}

function createQueryInspectorViewModel(
  preview: QueryLabPreviewResponse,
): QueryInspectorViewModel {
  const inspectorArgs = preview.normalizedArgs ?? preview.args;
  const prismaCall =
    preview.prismaCall ??
    `prisma.${preview.model.charAt(0).toLowerCase()}${preview.model.slice(1)}.${preview.operation}(${formatJsonBlock(inspectorArgs ?? {})})`;

  return {
    title: `${preview.model}.${preview.operation}`,
    normalizedArgsJson: formatJsonBlock(inspectorArgs ?? {}),
    prismaCall,
    normalizationMessages:
      preview.normalization?.map((item) => describeQueryLabNormalization(item)) ?? [],
    durationLabel: formatDuration(preview.timing?.durationMs),
    safetyLimits: [
      {
        label: "Args depth",
        value: `${preview.safetyLimits?.argsDepth ?? "Not available"} / ${
          preview.safetyLimits?.maxArgsDepth ?? "Not available"
        }`,
      },
      {
        label: "Timeout",
        value: `${preview.safetyLimits?.timeoutMs ?? "Not available"} ms`,
      },
      {
        label: "Response size",
        value: `${formatBytes(preview.safetyLimits?.responseSizeBytes)} / ${formatBytes(
          preview.safetyLimits?.maxResponseBytes,
        )}`,
      },
    ],
    warnings: preview.warnings ?? [],
    sqlEvents:
      preview.sql?.events?.map((event, index) => ({
        label: `SQL #${index + 1}`,
        durationLabel: event.durationMs !== undefined ? formatDuration(event.durationMs) : null,
        query: event.query ?? null,
        params: event.params ?? null,
      })) ?? [],
  };
}

function queryLabPreviewResult(preview: QueryLabPreviewResponse) {
  return preview.result !== undefined ? preview.result : (preview.rows ?? []);
}

function columnsForRows(rows: Record<string, unknown>[]) {
  const columns = new Set<string>();
  for (const row of rows) {
    Object.keys(row).forEach((key) => columns.add(key));
  }
  return Array.from(columns);
}

function rowsForQueryLabResult(
  operation: QueryLabOperation,
  result: unknown,
): Record<string, unknown>[] {
  if (operation === "findMany") {
    return Array.isArray(result) ? result.filter(isRowObject) : [];
  }
  if (operation === "findFirst" || operation === "findUnique") {
    return isRowObject(result) ? [result] : [];
  }
  return [];
}

function fieldsForRecord(record: Record<string, unknown> | null, model: Model | null) {
  if (!record) return [];
  return Object.keys(record).map((fieldName) => {
    const metadataField = model?.fields.find((field) => field.name === fieldName);
    return (
      metadataField ?? {
        name: fieldName,
        kind: "scalar" as const,
        type: Array.isArray(record[fieldName])
          ? "Json"
          : record[fieldName] === null
            ? "Unknown"
            : typeof record[fieldName] === "object"
              ? "Json"
              : typeof record[fieldName] === "number"
                ? "Number"
                : typeof record[fieldName] === "boolean"
                  ? "Boolean"
                  : "String",
        isList: Array.isArray(record[fieldName]),
        isRequired: record[fieldName] !== null && record[fieldName] !== undefined,
      }
    );
  });
}

function describeQueryLabNormalization(item: QueryLabArgsNormalization) {
  if (item.action === "cap") {
    return `${item.path}: capped from ${formatValue(item.originalValue)} to ${formatValue(item.value)}`;
  }

  return `${item.path}: safety default ${formatValue(item.value)} applied`;
}

function toStableJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, toStableJsonValue(item, seen)]),
    );
  }
  return value;
}

function clampRowIndex(selectedRowIndex: number, rowCount: number) {
  if (!Number.isInteger(selectedRowIndex) || selectedRowIndex < 0) return 0;
  if (rowCount === 0) return 0;
  return Math.min(selectedRowIndex, rowCount - 1);
}

function isRowObject(row: unknown): row is Record<string, unknown> {
  return typeof row === "object" && row !== null && !Array.isArray(row);
}
