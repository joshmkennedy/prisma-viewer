import type { Field, Model } from "../../domain/prisma-metadata";
import { formatJsonPreview } from "../../domain/row-formatting";

export type PreviewMode = "fields" | "json";

export function fieldsForRecord(
  record: Record<string, unknown> | null,
  model: Model | null,
): Field[] {
  if (!record) return [];
  return Object.keys(record).map((fieldName) => {
    const metadataField = model?.fields.find((field) => field.name === fieldName);
    return metadataField ?? createInferredField(fieldName, record[fieldName]);
  });
}

export function formatRecordPreviewJson(record: Record<string, unknown>) {
  return formatJsonPreview(record);
}

function createInferredField(name: string, value: unknown): Field {
  return {
    name,
    kind: "scalar",
    type: inferFieldType(value),
    isList: Array.isArray(value),
    isRequired: value !== null && value !== undefined,
  };
}

function inferFieldType(value: unknown) {
  if (Array.isArray(value)) return "Json";
  if (value === null) return "Unknown";
  if (typeof value === "object") return "Json";
  if (typeof value === "number") return "Number";
  if (typeof value === "boolean") return "Boolean";
  return "String";
}
