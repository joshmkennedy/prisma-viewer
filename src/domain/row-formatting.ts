import type { Field } from "./prisma-metadata";

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
