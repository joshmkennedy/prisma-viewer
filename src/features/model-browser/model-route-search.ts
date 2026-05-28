import type { SortingState } from "@tanstack/react-table";

export type FilterOperator =
  | "contains"
  | "equals"
  | "startsWith"
  | "endsWith"
  | "empty"
  | "notEmpty";

export type TableFilter = {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
};

export type UrlTableFilter = Omit<TableFilter, "id">;

export type ModelRouteSearch = {
  page: number;
  pageSize: number;
  search: string;
  filters: TableFilter[];
  sort: SortingState;
  row: number | null;
};

export type ModelRouteSearchInput = {
  page?: number;
  pageSize?: number;
  search?: string;
  filters?: UrlTableFilter[];
  sort?: string;
  row?: number;
};

export const DEFAULT_TABLE_PAGE_SIZE = 100;
export const TABLE_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export const filterOperators: {
  value: FilterOperator;
  label: string;
  needsValue: boolean;
}[] = [
  { value: "contains", label: "contains", needsValue: true },
  { value: "equals", label: "equals", needsValue: true },
  { value: "startsWith", label: "starts with", needsValue: true },
  { value: "endsWith", label: "ends with", needsValue: true },
  { value: "empty", label: "is empty", needsValue: false },
  { value: "notEmpty", label: "is not empty", needsValue: false },
];

export const DEFAULT_MODEL_ROUTE_SEARCH: ModelRouteSearch = {
  page: 1,
  pageSize: DEFAULT_TABLE_PAGE_SIZE,
  search: "",
  filters: [],
  sort: [],
  row: null,
};

export function toModelRouteSearchInput(search: ModelRouteSearch): ModelRouteSearchInput {
  return {
    page: search.page === DEFAULT_MODEL_ROUTE_SEARCH.page ? undefined : search.page,
    pageSize:
      search.pageSize === DEFAULT_MODEL_ROUTE_SEARCH.pageSize ? undefined : search.pageSize,
    search: search.search.trim() ? search.search : undefined,
    filters: toUrlFilters(search.filters),
    sort: encodeUrlSorting(search.sort),
    row: search.row ?? undefined,
  };
}

export function normalizeModelRouteSearch(
  rawSearch: ModelRouteSearchInput | Record<string, unknown>,
): ModelRouteSearch {
  const page = parsePositiveInteger(rawSearch.page, DEFAULT_MODEL_ROUTE_SEARCH.page);
  const requestedPageSize = parsePositiveInteger(
    rawSearch.pageSize,
    DEFAULT_MODEL_ROUTE_SEARCH.pageSize,
  );
  const pageSize = TABLE_PAGE_SIZE_OPTIONS.includes(
    requestedPageSize as (typeof TABLE_PAGE_SIZE_OPTIONS)[number],
  )
    ? requestedPageSize
    : DEFAULT_MODEL_ROUTE_SEARCH.pageSize;

  return {
    page,
    pageSize,
    search: typeof rawSearch.search === "string" ? rawSearch.search : "",
    filters: parseUrlFilters(rawSearch.filters),
    sort: parseUrlSorting(rawSearch.sort),
    row: parseRowIndex(rawSearch.row),
  };
}

export function validateModelRouteSearch(
  rawSearch: ModelRouteSearchInput | Record<string, unknown>,
): ModelRouteSearchInput {
  return toModelRouteSearchInput(normalizeModelRouteSearch(rawSearch));
}

function parsePositiveInteger(value: unknown, fallback: number) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseRowIndex(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function isFilterOperator(value: unknown): value is FilterOperator {
  return (
    typeof value === "string" && filterOperators.some((operator) => operator.value === value)
  );
}

function parseUrlFilters(value: unknown): TableFilter[] {
  const parsedValue =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return [];
          }
        })()
      : value;

  if (!Array.isArray(parsedValue)) return [];

  return parsedValue
    .map((filter, index) => {
      if (!filter || typeof filter !== "object") return null;
      const item = filter as Record<string, unknown>;
      if (typeof item.field !== "string" || !isFilterOperator(item.operator)) {
        return null;
      }

      return {
        id: `url-${index}-${item.field}-${item.operator}`,
        field: item.field,
        operator: item.operator,
        value: typeof item.value === "string" ? item.value : "",
      };
    })
    .filter((filter): filter is TableFilter => filter !== null);
}

function parseUrlSorting(value: unknown): SortingState {
  if (typeof value !== "string" || value.trim().length === 0) return [];

  return value
    .split(",")
    .map((item) => {
      const [field, direction] = item.split(":");
      if (!field || (direction !== "asc" && direction !== "desc")) return null;
      return { id: field, desc: direction === "desc" };
    })
    .filter((sort): sort is SortingState[number] => sort !== null);
}

function encodeUrlSorting(sorting: SortingState) {
  if (sorting.length === 0) return undefined;
  return sorting.map(({ id, desc }) => `${id}:${desc ? "desc" : "asc"}`).join(",");
}

function toUrlFilters(filters: TableFilter[]): UrlTableFilter[] | undefined {
  if (filters.length === 0) return undefined;
  return filters.map(({ field, operator, value }) => ({ field, operator, value }));
}
