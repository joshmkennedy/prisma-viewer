import type {
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from "@tanstack/react-table";
import { formatValue, type Field, type Model } from "./query-lab-result-presenter";

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

export type TableRefinements = {
  search: string;
  filters: TableFilter[];
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

export type TableRow = {
  row: Record<string, unknown>;
  rowIndex: number;
};

export type ModelRowsRequest = {
  modelName: string;
  page: number;
  pageSize: number;
  search: string;
  filters: TableFilter[];
  sorting: SortingState;
};

export type RowStatus = "idle" | "loading" | "success" | "error";

export type ModelTableBrowserInput = {
  modelName: string | null;
  rawSearch: ModelRouteSearchInput | Record<string, unknown>;
  models: Model[];
  rows: Record<string, unknown>[];
  rowStatus: RowStatus;
  loadedRefinements?: TableRefinements;
};

export type ModelTableBrowser = {
  selectedModel: Model | null;
  routeSearch: ModelRouteSearch;
  canonicalRouteSearch: ModelRouteSearch;
  canonicalSearch: ModelRouteSearchInput;
  tableFields: Field[];
  filterableFields: Field[];
  tableFilters: TableFilter[];
  activeFilters: TableFilter[];
  sorting: SortingState;
  pagination: PaginationState;
  columnFilters: ColumnFiltersState;
  pendingRefinements: TableRefinements;
  loadedRefinements: TableRefinements;
  hasLoadedRefinements: boolean;
  hasPendingRefinements: boolean;
  request: ModelRowsRequest | null;
  visibleRows: TableRow[];
  selectedRowIndex: number | null;
  selectedRow: Record<string, unknown> | null;
  summary: string;
  commands: {
    searchRows(value: string): ModelRouteSearchInput;
    addFilter(): ModelRouteSearchInput;
    updateFilter(id: string, updates: Partial<TableFilter>): ModelRouteSearchInput;
    updateFilterField(id: string, fieldName: string): ModelRouteSearchInput;
    removeFilter(id: string): ModelRouteSearchInput;
    clearRefinements(): ModelRouteSearchInput;
    changePagination(next: PaginationState): ModelRouteSearchInput;
    changeSorting(next: SortingState): ModelRouteSearchInput;
    selectRow(rowIndex: number): ModelRouteSearchInput;
    setPageSize(pageSize: number): ModelRouteSearchInput;
  };
};

export const ROW_REFINEMENT_DEBOUNCE_MS = 300;
export const DEFAULT_TABLE_PAGE_SIZE = 100;
export const TABLE_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const ROWS_QUERY_KEY = "modelRows";

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

export function createTableFilter(
  field = "",
  operator: FilterOperator = "contains",
  value = "",
): TableFilter {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    field,
    operator,
    value,
  };
}

export function isFilterableField(field: Field) {
  return (
    field.kind === "enum" ||
    (field.kind === "scalar" &&
      ["String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime"].includes(
        field.type,
      ))
  );
}

export function operatorsForField(field: Field | undefined) {
  if (!field) return [];
  if (field.type === "String") return filterOperators;
  if (field.kind === "enum") {
    return filterOperators.filter((operator) =>
      ["equals", "empty", "notEmpty"].includes(operator.value),
    );
  }
  return filterOperators.filter((operator) =>
    ["equals", "empty", "notEmpty"].includes(operator.value),
  );
}

export function enumValuesForField(field: Field | undefined) {
  return field?.kind === "enum" ? (field.enumValues ?? []) : [];
}

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

export function createModelRowsRequestUrl(request: ModelRowsRequest) {
  const searchParams = new URLSearchParams({
    page: String(request.page),
    pageSize: String(request.pageSize),
  });
  const trimmedSearch = request.search.trim();
  if (trimmedSearch) searchParams.set("search", trimmedSearch);
  if (request.filters.length > 0) {
    searchParams.set(
      "filters",
      JSON.stringify(
        request.filters.map(({ field, operator, value }) => ({
          field,
          operator,
          value,
        })),
      ),
    );
  }
  if (request.sorting.length > 0) {
    searchParams.set(
      "sort",
      JSON.stringify(
        request.sorting.map(({ id, desc }) => ({
          field: id,
          direction: desc ? "desc" : "asc",
        })),
      ),
    );
  }

  return `/api/models/${encodeURIComponent(request.modelName)}/rows?${searchParams.toString()}`;
}

export function createModelTableBrowser({
  modelName,
  rawSearch,
  models,
  rows,
  rowStatus,
  loadedRefinements,
}: ModelTableBrowserInput): ModelTableBrowser {
  const routeSearch = normalizeModelRouteSearch(rawSearch);
  const selectedModel =
    modelName === null ? null : (models.find((model) => model.name === modelName) ?? null);
  const tableFields =
    selectedModel?.fields.filter((field) => field.kind === "scalar" || field.kind === "enum") ??
    [];
  const filterableFields = tableFields.filter((field) => isFilterableField(field));
  const tableFilters = pruneFilters(routeSearch.filters, filterableFields);
  const activeFilters = tableFilters.filter((filter) => {
    const field = filterableFields.find((candidate) => candidate.name === filter.field);
    const operator = operatorsForField(field).find((item) => item.value === filter.operator);
    return operator?.needsValue === false || filter.value.trim().length > 0;
  });
  const sorting = routeSearch.sort.filter((sort) =>
    tableFields.some((field) => field.name === sort.id),
  );
  const pagination = {
    pageIndex: routeSearch.page - 1,
    pageSize: routeSearch.pageSize,
  };
  const columnFilters = activeFilters.map(({ field, operator, value }) => ({
    id: field,
    value: { operator, value },
  }));
  const pendingRefinements = {
    search: routeSearch.search,
    filters: activeFilters,
  };
  const effectiveLoadedRefinements = loadedRefinements ?? pendingRefinements;
  const visibleRows = createVisibleRows(rows, tableFields, effectiveLoadedRefinements);
  const selectedRowIndex = routeSearch.row;
  const selectedRow = selectedRowIndex === null ? null : (rows[selectedRowIndex] ?? null);
  const hasLoadedRefinements =
    effectiveLoadedRefinements.search.trim().length > 0 ||
    effectiveLoadedRefinements.filters.length > 0;
  const hasPendingRefinements =
    pendingRefinements.search.trim().length > 0 || pendingRefinements.filters.length > 0;
  const canonicalRouteSearch = canonicalizeRouteSearch({
    routeSearch,
    tableFilters,
    sorting,
    selectedRowIndex,
    rowStatus,
    rows,
    visibleRows,
    hasLoadedRefinements,
  });

  const request = selectedModel
    ? {
        modelName: selectedModel.name,
        page: routeSearch.page,
        pageSize: routeSearch.pageSize,
        search: pendingRefinements.search,
        filters: pendingRefinements.filters,
        sorting,
      }
    : null;

  const routeForCommands = {
    ...routeSearch,
    filters: tableFilters,
    sort: sorting,
    row: canonicalRouteSearch.row,
  };

  return {
    selectedModel,
    routeSearch,
    canonicalRouteSearch,
    canonicalSearch: toModelRouteSearchInput(canonicalRouteSearch),
    tableFields,
    filterableFields,
    tableFilters,
    activeFilters,
    sorting,
    pagination,
    columnFilters,
    pendingRefinements,
    loadedRefinements: effectiveLoadedRefinements,
    hasLoadedRefinements,
    hasPendingRefinements,
    request,
    visibleRows,
    selectedRowIndex,
    selectedRow,
    summary: formatRowSummary(rowStatus, rows.length, tableFields.length, visibleRows.length, hasLoadedRefinements),
    commands: {
      searchRows(value) {
        return nextSearchInput(routeForCommands, {
          page: 1,
          search: value,
          row: null,
        });
      },
      addFilter() {
        const defaultField = filterableFields[0];
        if (!defaultField) return toModelRouteSearchInput(routeForCommands);
        const operator = operatorsForField(defaultField)[0]?.value ?? "equals";
        const value =
          defaultField.kind === "enum" && operator === "equals"
            ? enumValuesForField(defaultField)[0] ?? ""
            : "";
        return nextSearchInput(routeForCommands, {
          page: 1,
          filters: [...tableFilters, createTableFilter(defaultField.name, operator, value)],
          row: null,
        });
      },
      updateFilter(id, updates) {
        return nextSearchInput(routeForCommands, {
          page: 1,
          filters: tableFilters.map((filter) =>
            filter.id === id ? { ...filter, ...updates } : filter,
          ),
          row: null,
        });
      },
      updateFilterField(id, fieldName) {
        const field = filterableFields.find((candidate) => candidate.name === fieldName);
        const supportedOperators = operatorsForField(field);
        const enumValues = enumValuesForField(field);
        return nextSearchInput(routeForCommands, {
          page: 1,
          filters: tableFilters.map((filter) => {
            if (filter.id !== id) return filter;
            const operator = supportedOperators.some((item) => item.value === filter.operator)
              ? filter.operator
              : supportedOperators[0]?.value ?? "equals";
            const value =
              field?.kind === "enum" && operator === "equals" && !enumValues.includes(filter.value)
                ? enumValues[0] ?? ""
                : filter.value;

            return {
              ...filter,
              field: fieldName,
              operator,
              value,
            };
          }),
          row: null,
        });
      },
      removeFilter(id) {
        return nextSearchInput(routeForCommands, {
          page: 1,
          filters: tableFilters.filter((filter) => filter.id !== id),
          row: null,
        });
      },
      clearRefinements() {
        return nextSearchInput(routeForCommands, {
          page: 1,
          search: "",
          filters: [],
          row: null,
        });
      },
      changePagination(next) {
        return nextSearchInput(routeForCommands, {
          page: next.pageIndex + 1,
          pageSize: next.pageSize,
          row: null,
        });
      },
      changeSorting(next) {
        return nextSearchInput(routeForCommands, {
          page: 1,
          sort: next,
          row: null,
        });
      },
      selectRow(rowIndex) {
        return nextSearchInput(routeForCommands, { row: rowIndex });
      },
      setPageSize(pageSize) {
        return nextSearchInput(routeForCommands, {
          page: 1,
          pageSize,
          row: null,
        });
      },
    },
  };
}

function nextSearchInput(
  currentSearch: ModelRouteSearch,
  updates: Partial<ModelRouteSearch>,
) {
  return toModelRouteSearchInput({ ...currentSearch, ...updates });
}

function canonicalizeRouteSearch({
  routeSearch,
  tableFilters,
  sorting,
  selectedRowIndex,
  rowStatus,
  rows,
  visibleRows,
  hasLoadedRefinements,
}: {
  routeSearch: ModelRouteSearch;
  tableFilters: TableFilter[];
  sorting: SortingState;
  selectedRowIndex: number | null;
  rowStatus: RowStatus;
  rows: Record<string, unknown>[];
  visibleRows: TableRow[];
  hasLoadedRefinements: boolean;
}) {
  let row = selectedRowIndex;
  if (
    row !== null &&
    ((hasLoadedRefinements && !visibleRows.some((item) => item.rowIndex === row)) ||
      (rowStatus === "success" && rows[row] === undefined))
  ) {
    row = null;
  }

  return {
    ...routeSearch,
    filters: tableFilters,
    sort: sorting,
    row,
  };
}

function createVisibleRows(
  rows: Record<string, unknown>[],
  tableFields: Field[],
  refinements: TableRefinements,
) {
  const query = refinements.search.trim().toLowerCase();

  return rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => {
      const matchesSearch =
        !query ||
        tableFields.some((field) => normalizeSearchValue(row[field.name]).includes(query));

      return matchesSearch && refinements.filters.every((filter) => rowMatchesFilter(row, filter));
    });
}

function formatRowSummary(
  rowStatus: RowStatus,
  rowCount: number,
  columnCount: number,
  visibleRowCount: number,
  hasTableRefinements: boolean,
) {
  const columnLabel = columnCount === 1 ? "column" : "columns";

  if (rowStatus === "loading") {
    return `Loading rows, ${columnCount} ${columnLabel} shown`;
  }

  if (rowStatus === "error") {
    return `Rows unavailable, ${columnCount} ${columnLabel} shown`;
  }

  const rowLabel = rowCount === 1 ? "row" : "rows";
  if (hasTableRefinements) {
    const matchLabel = visibleRowCount === 1 ? "match" : "matches";
    return `${visibleRowCount} ${matchLabel} loaded, ${columnCount} ${columnLabel} shown`;
  }

  return `${rowCount} ${rowLabel} loaded, ${columnCount} ${columnLabel} shown`;
}

function pruneFilters(filters: TableFilter[], filterableFields: Field[]) {
  return filters.filter((filter) => {
    const field = filterableFields.find((candidate) => candidate.name === filter.field);
    if (!field) return false;
    const operator = operatorsForField(field).find((item) => item.value === filter.operator);
    if (!operator) return false;
    if (
      field.kind === "enum" &&
      operator.needsValue !== false &&
      field.enumValues?.length &&
      !field.enumValues.includes(filter.value)
    ) {
      return false;
    }
    return true;
  });
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

function normalizeSearchValue(value: unknown) {
  return formatValue(value).toLowerCase();
}

function isEmptyValue(value: unknown) {
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || value === "";
}

function rowMatchesFilter(row: Record<string, unknown>, filter: TableFilter) {
  const rawValue = row[filter.field];
  if (filter.operator === "empty") return isEmptyValue(rawValue);
  if (filter.operator === "notEmpty") return !isEmptyValue(rawValue);

  const query = filter.value.trim().toLowerCase();
  if (!query) return true;

  if (Array.isArray(rawValue)) {
    const values = rawValue.map((item) => normalizeSearchValue(item));
    if (filter.operator === "equals") return values.includes(query);
    if (filter.operator === "startsWith") {
      return values.some((value) => value.startsWith(query));
    }
    if (filter.operator === "endsWith") {
      return values.some((value) => value.endsWith(query));
    }
    return values.some((value) => value.includes(query));
  }

  const value = normalizeSearchValue(rawValue);
  if (filter.operator === "equals") return value === query;
  if (filter.operator === "startsWith") return value.startsWith(query);
  if (filter.operator === "endsWith") return value.endsWith(query);
  return value.includes(query);
}
