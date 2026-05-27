import type { IncomingMessage, ServerResponse } from "node:http";
import type { PrismaModelMetadata } from "./metadata.js";
import { MetadataError, discoverPrismaMetadata } from "./metadata.js";
import type { PrismaRuntime } from "./prisma.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type ApiErrorCode =
  | "DELEGATE_UNAVAILABLE"
  | "INVALID_PAGINATION"
  | "METHOD_NOT_ALLOWED"
  | "METADATA_UNAVAILABLE"
  | "MODEL_NOT_FOUND"
  | "ROWS_UNAVAILABLE";

type MiddlewareNext = (error?: unknown) => void;

export function createPrismaApiMiddleware(prismaRuntime: PrismaRuntime) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: MiddlewareNext,
  ) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === "/api/models") {
      handleModelsRequest(request, response, prismaRuntime);
      return;
    }

    const rowRoute = parseRowsRoute(url.pathname);
    if (!rowRoute) {
      next();
      return;
    }

    await handleRowsRequest(request, response, prismaRuntime, rowRoute.modelName, url);
  };
}

function handleModelsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  prismaRuntime: PrismaRuntime,
) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Prisma Viewer exposes only read-only API endpoints.",
      },
    });
    return;
  }

  try {
    sendJson(response, 200, discoverPrismaMetadata(prismaRuntime.client));
  } catch (error) {
    sendJson(response, 500, {
      error: {
        code: "METADATA_UNAVAILABLE",
        message:
          error instanceof MetadataError
            ? error.message
            : "Could not discover Prisma model metadata.",
      },
    });
  }
}

async function handleRowsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  prismaRuntime: PrismaRuntime,
  modelName: string,
  url: URL,
) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Prisma Viewer exposes only read-only API endpoints.",
      },
    });
    return;
  }

  let metadata;
  try {
    metadata = discoverPrismaMetadata(prismaRuntime.client);
  } catch (error) {
    sendJson(response, 500, {
      error: {
        code: "METADATA_UNAVAILABLE",
        message:
          error instanceof MetadataError
            ? error.message
            : "Could not discover Prisma model metadata.",
      },
    });
    return;
  }

  const model = metadata.models.find((candidate) => candidate.name === modelName);
  if (!model) {
    sendJson(response, 404, {
      error: {
        code: "MODEL_NOT_FOUND",
        message: `Unknown Prisma model: ${modelName}.`,
      },
    });
    return;
  }

  const pagination = parsePagination(url.searchParams);
  if ("error" in pagination) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_PAGINATION",
        message: pagination.error,
      },
    });
    return;
  }

  const delegate = prismaRuntime.client[delegateNameForModel(model.name)];
  if (!isFindManyDelegate(delegate)) {
    sendJson(response, 500, {
      error: {
        code: "DELEGATE_UNAVAILABLE",
        message: `Could not find a read-only Prisma delegate for model ${model.name}.`,
      },
    });
    return;
  }

  try {
    const rows = await delegate.findMany({
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: selectFieldsForModel(model),
    });

    sendJson(response, 200, {
      model: model.name,
      rows,
      pagination,
    });
  } catch (error) {
    sendJson(response, 500, {
      error: {
        code: "ROWS_UNAVAILABLE",
        message:
          error instanceof Error && error.message
            ? `Could not list rows for model ${model.name}: ${error.message}`
            : `Could not list rows for model ${model.name}.`,
      },
    });
  }
}

function parseRowsRoute(pathname: string) {
  const match = /^\/api\/models\/([^/]+)\/rows$/.exec(pathname);
  if (!match) return undefined;

  return {
    modelName: decodeURIComponent(match[1]),
  };
}

function parsePagination(searchParams: URLSearchParams) {
  const page = parsePositiveInteger(searchParams.get("page") ?? "1");
  if (!page) {
    return { error: "The page query parameter must be a positive integer." };
  }

  const pageSize = parsePositiveInteger(
    searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE),
  );
  if (!pageSize || pageSize > MAX_PAGE_SIZE) {
    return {
      error: `The pageSize query parameter must be a positive integer no greater than ${MAX_PAGE_SIZE}.`,
    };
  }

  return { page, pageSize };
}

function parsePositiveInteger(value: string) {
  if (!/^\d+$/.test(value)) return undefined;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return undefined;

  return parsed;
}

function delegateNameForModel(modelName: string) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

function selectFieldsForModel(model: PrismaModelMetadata) {
  return model.fields.reduce<Record<string, true>>((select, field) => {
    if (field.kind === "scalar" || field.kind === "enum") {
      select[field.name] = true;
    }

    return select;
  }, {});
}

function isFindManyDelegate(value: unknown): value is {
  findMany: (args: {
    skip: number;
    take: number;
    select: Record<string, true>;
  }) => Promise<unknown[]>;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "findMany" in value &&
    typeof value.findMany === "function"
  );
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: { error: { code: ApiErrorCode; message: string } } | unknown,
) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
