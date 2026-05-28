import type { Field, Model } from "../../domain/prisma-metadata";
import {
  formatBytes,
  formatDuration,
  formatJsonBlock,
  formatValue,
} from "../../domain/row-formatting";
import {
  fieldsForRecord,
  formatRecordPreviewJson,
  type PreviewMode,
} from "../record-preview/record-preview-model";

export type QueryLabResultMode = "table" | "json";
export type QueryLabOperation = "findMany" | "findFirst" | "findUnique" | "count";

export const QUERY_LAB_OPERATIONS: QueryLabOperation[] = [
  "findMany",
  "findFirst",
  "findUnique",
  "count",
];

export function isQueryLabOperation(value: unknown): value is QueryLabOperation {
  return (
    typeof value === "string" && QUERY_LAB_OPERATIONS.includes(value as QueryLabOperation)
  );
}

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
    selectedRecordJson: selectedRow ? formatRecordPreviewJson(selectedRow) : null,
    inspector,
  };
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

function describeQueryLabNormalization(item: QueryLabArgsNormalization) {
  if (item.action === "cap") {
    return `${item.path}: capped from ${formatValue(item.originalValue)} to ${formatValue(item.value)}`;
  }

  return `${item.path}: safety default ${formatValue(item.value)} applied`;
}

function clampRowIndex(selectedRowIndex: number, rowCount: number) {
  if (!Number.isInteger(selectedRowIndex) || selectedRowIndex < 0) return 0;
  if (rowCount === 0) return 0;
  return Math.min(selectedRowIndex, rowCount - 1);
}

function isRowObject(row: unknown): row is Record<string, unknown> {
  return typeof row === "object" && row !== null && !Array.isArray(row);
}
