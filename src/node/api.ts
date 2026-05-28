import type { IncomingMessage, ServerResponse } from "node:http";
import type { PrismaFieldMetadata, PrismaModelMetadata } from "./metadata.js";
import { MetadataError, discoverPrismaMetadata } from "./metadata.js";
import type { PrismaRuntime } from "./prisma.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type ApiErrorCode =
  | "DELEGATE_UNAVAILABLE"
  | "INVALID_FILTER"
  | "INVALID_PAGINATION"
  | "METHOD_NOT_ALLOWED"
  | "METADATA_UNAVAILABLE"
  | "MODEL_NOT_FOUND"
  | "ROWS_UNAVAILABLE";

type MiddlewareNext = (error?: unknown) => void;

type FilterOperator = "contains" | "equals" | "startsWith" | "endsWith" | "empty" | "notEmpty";

type RowFilter = {
  field: string;
  operator: FilterOperator;
  value?: string;
};

type RowSort = {
  field: string;
  direction: "asc" | "desc";
};

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

  const filters = parseFilters(url.searchParams);
  if ("error" in filters) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_FILTER",
        message: filters.error,
      },
    });
    return;
  }

  const where = buildWhereClause(model, filters.search, filters.filters);
  if ("error" in where) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_FILTER",
        message: where.error,
      },
    });
    return;
  }

  const sorting = parseSorting(url.searchParams, model);
  if ("error" in sorting) {
    sendJson(response, 400, {
      error: {
        code: "INVALID_FILTER",
        message: sorting.error,
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
    const findManyArgs = {
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: selectFieldsForModel(model),
      ...(where.where ? { where: where.where } : {}),
      ...(sorting.orderBy ? { orderBy: sorting.orderBy } : {}),
    };
    const rows = await delegate.findMany(findManyArgs);

    sendJson(response, 200, {
      model: model.name,
      rows,
      pagination: {
        ...pagination,
        filtersApplied: where.where ? true : undefined,
      },
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

function parseFilters(searchParams: URLSearchParams): { search: string; filters: RowFilter[] } | { error: string } {
  const search = searchParams.get("search")?.trim() ?? "";
  const rawFilters = searchParams.get("filters");
  if (!rawFilters) return { search, filters: [] };

  try {
    const parsed = JSON.parse(rawFilters) as unknown;
    if (!Array.isArray(parsed)) {
      return { error: "The filters query parameter must be a JSON array." };
    }

    const filters: RowFilter[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        return { error: "Each filter must be an object." };
      }
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.field !== "string" || candidate.field.trim() === "") {
        return { error: "Each filter must include a field." };
      }
      if (!isFilterOperator(candidate.operator)) {
        return { error: "Each filter must include a supported operator." };
      }
      if (
        candidate.value !== undefined &&
        candidate.value !== null &&
        typeof candidate.value !== "string"
      ) {
        return { error: "Filter values must be strings." };
      }

      filters.push({
        field: candidate.field,
        operator: candidate.operator,
        value: candidate.value ?? undefined,
      });
    }

    return { search, filters };
  } catch {
    return { error: "The filters query parameter must be valid JSON." };
  }
}

function isFilterOperator(value: unknown): value is FilterOperator {
  return (
    value === "contains" ||
    value === "equals" ||
    value === "startsWith" ||
    value === "endsWith" ||
    value === "empty" ||
    value === "notEmpty"
  );
}

function buildWhereClause(
  model: PrismaModelMetadata,
  search: string,
  filters: RowFilter[],
): { where?: Record<string, unknown> } | { error: string } {
  const and: Record<string, unknown>[] = [];
  const searchableFields = model.fields.filter(
    (field) => field.kind === "scalar" && field.type === "String",
  );

  if (search && searchableFields.length > 0) {
    and.push({
      OR: searchableFields.map((field) => ({
        [field.name]: { contains: search },
      })),
    });
  }

  for (const filter of filters) {
    const field = model.fields.find((candidate) => candidate.name === filter.field);
    if (!field || (field.kind !== "scalar" && field.kind !== "enum")) {
      return { error: `Cannot filter by unknown or unsupported field: ${filter.field}.` };
    }

    const condition = buildFieldFilter(field, filter);
    if ("error" in condition) return condition;
    and.push(condition.where);
  }

  if (and.length === 0) return {};
  if (and.length === 1) return { where: and[0] };
  return { where: { AND: and } };
}

function buildFieldFilter(
  field: PrismaFieldMetadata,
  filter: RowFilter,
): { where: Record<string, unknown> } | { error: string } {
  if (filter.operator === "empty") {
    if (field.isList) {
      return { where: { [field.name]: { isEmpty: true } } };
    }

    if (field.type === "String") {
      return field.isRequired
        ? { where: { [field.name]: "" } }
        : { where: { OR: [{ [field.name]: null }, { [field.name]: "" }] } };
    }
    return field.isRequired
      ? { error: `Field ${field.name} cannot be empty because it is required.` }
      : { where: { [field.name]: null } };
  }

  if (filter.operator === "notEmpty") {
    if (field.isList) {
      return { where: { [field.name]: { isEmpty: false } } };
    }

    if (field.type === "String") {
      const clauses: Record<string, unknown>[] = [{ [field.name]: { not: "" } }];
      if (!field.isRequired) clauses.push({ [field.name]: { not: null } });
      return { where: { AND: clauses } };
    }
    return field.isRequired
      ? { where: {} }
      : { where: { [field.name]: { not: null } } };
  }

  const value = filter.value?.trim() ?? "";
  if (!value) return { where: {} };

  if (field.kind === "enum") {
    if (filter.operator !== "equals") {
      return { error: `Enum field ${field.name} supports only equals filters.` };
    }
    if (field.enumValues.length > 0 && !field.enumValues.includes(value)) {
      return {
        error: `Invalid value for ${field.name}: expected one of ${field.enumValues.join(", ")}.`,
      };
    }
    return {
      where: {
        [field.name]: field.isList ? { has: value } : value,
      },
    };
  }

  if (field.type === "String") {
    return { where: { [field.name]: { [filter.operator]: value } } };
  }

  if (filter.operator !== "equals") {
    return { error: `Field ${field.name} supports only equals, empty, or not empty filters.` };
  }

  const parsed = parseScalarFilterValue(field.type, value);
  if ("error" in parsed) return { error: `Invalid value for ${field.name}: ${parsed.error}` };
  return { where: { [field.name]: parsed.value } };
}

function parseScalarFilterValue(type: string, value: string): { value: unknown } | { error: string } {
  if (type === "Boolean") {
    if (value.toLowerCase() === "true") return { value: true };
    if (value.toLowerCase() === "false") return { value: false };
    return { error: "expected true or false." };
  }

  if (["Int", "BigInt", "Float", "Decimal"].includes(type)) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return { error: "expected a number." };
    return { value: parsed };
  }

  if (type === "DateTime") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return { error: "expected a valid date." };
    return { value: parsed };
  }

  return { error: `field type ${type} is not filterable.` };
}

function parseSorting(
  searchParams: URLSearchParams,
  model: PrismaModelMetadata,
): { orderBy?: Record<string, RowSort["direction"]>[] } | { error: string } {
  const rawSorting = searchParams.get("sort");
  if (!rawSorting) return {};

  try {
    const parsed = JSON.parse(rawSorting) as unknown;
    if (!Array.isArray(parsed)) {
      return { error: "The sort query parameter must be a JSON array." };
    }

    const orderBy: RowSort[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        return { error: "Each sort must be an object." };
      }

      const candidate = item as Record<string, unknown>;
      if (typeof candidate.field !== "string" || candidate.field.trim() === "") {
        return { error: "Each sort must include a field." };
      }
      if (candidate.direction !== "asc" && candidate.direction !== "desc") {
        return { error: "Each sort must include asc or desc direction." };
      }

      const field = model.fields.find((field) => field.name === candidate.field);
      if (!field || (field.kind !== "scalar" && field.kind !== "enum")) {
        return { error: `Cannot sort by unknown or unsupported field: ${candidate.field}.` };
      }

      orderBy.push({
        field: candidate.field,
        direction: candidate.direction,
      });
    }

    return orderBy.length > 0
      ? { orderBy: orderBy.map(({ field, direction }) => ({ [field]: direction })) }
      : {};
  } catch {
    return { error: "The sort query parameter must be valid JSON." };
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
    where?: Record<string, unknown>;
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
