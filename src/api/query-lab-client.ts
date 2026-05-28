import { formatApiError } from "./prisma-viewer-client";
import type {
  QueryLabOperation,
  QueryLabPreviewResponse,
} from "../query-lab-result-presenter";

export async function previewQueryLab(
  payload: {
    model: string;
    operation: QueryLabOperation;
    argsSource: string;
  },
  signal?: AbortSignal,
): Promise<QueryLabPreviewResponse> {
  const response = await fetch("/api/query-lab/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(await formatApiError(response, "Query Lab preview API"));
  }

  return (await response.json()) as QueryLabPreviewResponse;
}
