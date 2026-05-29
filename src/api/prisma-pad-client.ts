import type { Model } from "../domain/prisma-metadata";
import {
  createModelRowsRequestUrl,
  type ModelRowsRequest,
} from "../features/model-browser/model-table-controller";

type MetadataResponse = {
  models: Model[];
};

export type RowsResponse = {
  rows: Record<string, unknown>[];
  pagination?: {
    page: number;
    pageSize: number;
    filtersApplied?: boolean;
  };
  query?: ModelRowsQueryInspector;
};

export type ModelRowsQueryInspector = {
  model: string;
  delegateName: string;
  operation: "findMany";
  args: {
    where?: Record<string, unknown>;
    orderBy?: Array<Record<string, "asc" | "desc">>;
    select: Record<string, true>;
    skip: number;
    take: number;
  };
  where?: Record<string, unknown>;
  orderBy?: Array<Record<string, "asc" | "desc">>;
  select: Record<string, true>;
  skip: number;
  take: number;
  prismaCall: string;
  contributors: Array<{
    source: "search" | "filter" | "sort" | "page" | "pageSize" | "select";
    label: string;
    path: "where" | "orderBy" | "select" | "skip" | "take";
  }>;
};

export async function fetchModelMetadata(signal: AbortSignal): Promise<Model[]> {
  const response = await fetch("/api/models", { signal });

  if (!response.ok) {
    throw new Error(await formatApiError(response, "Metadata API"));
  }

  const body = (await response.json()) as MetadataResponse;
  return body.models;
}

export async function fetchModelRows(
  request: ModelRowsRequest,
  signal: AbortSignal,
): Promise<RowsResponse> {
  const response = await fetch(createModelRowsRequestUrl(request), { signal });

  if (!response.ok) {
    throw new Error(await formatApiError(response, "Rows API"));
  }

  const body = (await response.json()) as RowsResponse;
  return body;
}

export async function formatApiError(response: Response, label: string) {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    if (body.error?.message) return body.error.message;
  } catch {
    // Fall through to the status-only message when the API body is unavailable.
  }

  return `${label} returned ${response.status}`;
}

type ApiErrorResponse = {
  error?: {
    message?: string;
  };
};
