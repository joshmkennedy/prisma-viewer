import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  FileJson,
  Filter,
  Plus,
  RefreshCcw,
  Search,
  TableProperties,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { cn } from "./lib/utils";

type Field = {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
  enumValues?: string[];
  isList: boolean;
  isRequired: boolean;
};

type Model = {
  name: string;
  fields: Field[];
};

type MetadataResponse = {
  models: Model[];
};

type RowsResponse = {
  rows: Record<string, unknown>[];
  pagination?: {
    page: number;
    pageSize: number;
    filtersApplied?: boolean;
  };
};

type ApiErrorResponse = {
  error?: {
    message?: string;
  };
};

type ModelLoadState =
  | { status: "loading"; models: Model[]; error: null }
  | { status: "success"; models: Model[]; error: null }
  | { status: "error"; models: Model[]; error: string };

type RowLoadState =
  | { status: "idle"; rows: Record<string, unknown>[]; error: null }
  | { status: "loading"; rows: Record<string, unknown>[]; error: null }
  | { status: "success"; rows: Record<string, unknown>[]; error: null }
  | { status: "error"; rows: Record<string, unknown>[]; error: string };

type PreviewMode = "fields" | "json";
type FilterOperator = "contains" | "equals" | "startsWith" | "endsWith" | "empty" | "notEmpty";

type TableFilter = {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
};

type TableRefinements = {
  search: string;
  filters: TableFilter[];
};

type TableRow = {
  row: Record<string, unknown>;
  rowIndex: number;
};

const ROW_REFINEMENT_DEBOUNCE_MS = 300;
const DEFAULT_TABLE_PAGE_SIZE = 100;
const TABLE_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const ROWS_QUERY_KEY = "modelRows";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

const filterOperators: { value: FilterOperator; label: string; needsValue: boolean }[] = [
  { value: "contains", label: "contains", needsValue: true },
  { value: "equals", label: "equals", needsValue: true },
  { value: "startsWith", label: "starts with", needsValue: true },
  { value: "endsWith", label: "ends with", needsValue: true },
  { value: "empty", label: "is empty", needsValue: false },
  { value: "notEmpty", label: "is not empty", needsValue: false },
];

function createTableFilter(
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

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debouncedValue;
}

function isFilterableField(field: Field) {
  return (
    field.kind === "enum" ||
    (field.kind === "scalar" &&
      ["String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime"].includes(
        field.type,
      ))
  );
}

function operatorsForField(field: Field | undefined) {
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

function enumValuesForField(field: Field | undefined) {
  return field?.kind === "enum" ? (field.enumValues ?? []) : [];
}

function formatValue(value: unknown) {
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

function getCellTone(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" || typeof value === "bigint") return "number";
  if (typeof value === "object") return "json";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return "date";
  return "text";
}

function formatFieldType(field: Field) {
  const listSuffix = field.isList ? "[]" : "";
  const requiredSuffix = field.isRequired ? "" : "?";
  return `${field.type}${listSuffix}${requiredSuffix}`;
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

function formatJsonPreview(row: Record<string, unknown>) {
  return JSON.stringify(toStableJsonValue(row), null, 2);
}

function formatRowSummary(
  rowState: RowLoadState,
  columnCount: number,
  visibleRowCount: number,
  hasTableRefinements: boolean,
) {
  const columnLabel = columnCount === 1 ? "column" : "columns";

  if (rowState.status === "loading") {
    return `Loading rows, ${columnCount} ${columnLabel} shown`;
  }

  if (rowState.status === "error") {
    return `Rows unavailable, ${columnCount} ${columnLabel} shown`;
  }

  const rowLabel = rowState.rows.length === 1 ? "row" : "rows";
  if (hasTableRefinements) {
    const matchLabel = visibleRowCount === 1 ? "match" : "matches";
    return `${visibleRowCount} ${matchLabel} loaded, ${columnCount} ${columnLabel} shown`;
  }

  return `${rowState.rows.length} ${rowLabel} loaded, ${columnCount} ${columnLabel} shown`;
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

async function fetchModelMetadata(signal: AbortSignal): Promise<Model[]> {
  const response = await fetch("/api/models", { signal });

  if (!response.ok) {
    throw new Error(await formatApiError(response, "Metadata API"));
  }

  const body = (await response.json()) as MetadataResponse;
  return body.models;
}

async function fetchModelRows(
  modelName: string,
  signal: AbortSignal,
  page: number,
  pageSize: number,
  search = "",
  filters: TableFilter[] = [],
  sorting: SortingState = [],
): Promise<RowsResponse> {
  const searchParams = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const trimmedSearch = search.trim();
  if (trimmedSearch) searchParams.set("search", trimmedSearch);
  if (filters.length > 0) {
    searchParams.set(
      "filters",
      JSON.stringify(
        filters.map(({ field, operator, value }) => ({
          field,
          operator,
          value,
        })),
      ),
    );
  }
  if (sorting.length > 0) {
    searchParams.set(
      "sort",
      JSON.stringify(
        sorting.map(({ id, desc }) => ({
          field: id,
          direction: desc ? "desc" : "asc",
        })),
      ),
    );
  }

  const response = await fetch(
    `/api/models/${encodeURIComponent(modelName)}/rows?${searchParams.toString()}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(await formatApiError(response, "Rows API"));
  }

  const body = (await response.json()) as RowsResponse;
  return body;
}

async function formatApiError(response: Response, label: string) {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    if (body.error?.message) return body.error.message;
  } catch {
    // Fall through to the status-only message when the API body is unavailable.
  }

  return `${label} returned ${response.status}`;
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <AppContent routedModelName={null} />,
});

const modelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/model/$modelName",
  component: ModelRoute,
});

const routeTree = rootRoute.addChildren([indexRoute, modelRoute]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function ModelRoute() {
  const { modelName } = modelRoute.useParams();
  return <AppContent routedModelName={modelName} />;
}

function AppContent({ routedModelName }: { routedModelName: string | null }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [tableFilters, setTableFilters] = useState<TableFilter[]>([]);
  const [loadedTableRefinements, setLoadedTableRefinements] = useState<TableRefinements>({
    search: "",
    filters: [],
  });
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
  });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("fields");

  const modelQuery = useQuery({
    queryKey: ["models"],
    queryFn: ({ signal }) => fetchModelMetadata(signal),
  });

  const modelState: ModelLoadState = modelQuery.isLoading
    ? { status: "loading", models: [], error: null }
    : modelQuery.isError
      ? {
          status: "error",
          models: [],
          error:
            modelQuery.error instanceof Error
              ? modelQuery.error.message
              : "Could not load Prisma model metadata.",
        }
      : { status: "success", models: modelQuery.data ?? [], error: null };

  const models = modelState.models;
  const filteredModels = useMemo(
    () =>
      models.filter((model) =>
        model.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [models, search],
  );

  const selectedModel =
    routedModelName === null
      ? null
      : (models.find((model) => model.name === routedModelName) ?? null);
  const isModelRoute = routedModelName !== null;
  const tableFields = useMemo(
    () =>
      selectedModel?.fields.filter(
        (field) => field.kind === "scalar" || field.kind === "enum",
      ) ?? [],
    [selectedModel],
  );
  const filterableFields = useMemo(
    () => tableFields.filter((field) => isFilterableField(field)),
    [tableFields],
  );
  const activeTableFilters = useMemo(
    () =>
      tableFilters.filter((filter) => {
        const field = filterableFields.find((candidate) => candidate.name === filter.field);
        if (!field) return false;
        const operator = operatorsForField(field).find(
          (item) => item.value === filter.operator,
        );
        if (
          field.kind === "enum" &&
          operator?.needsValue !== false &&
          field.enumValues?.length &&
          !field.enumValues.includes(filter.value)
        ) {
          return false;
        }
        return operator?.needsValue === false || filter.value.trim().length > 0;
      }),
    [filterableFields, tableFilters],
  );
  const columnFilters = useMemo<ColumnFiltersState>(
    () =>
      activeTableFilters.map(({ field, operator, value }) => ({
        id: field,
        value: { operator, value },
      })),
    [activeTableFilters],
  );
  const pendingTableRefinements = useMemo<TableRefinements>(
    () => ({
      search: tableSearch,
      filters: activeTableFilters,
    }),
    [activeTableFilters, tableSearch],
  );
  const debouncedTableRefinements = useDebouncedValue(
    pendingTableRefinements,
    ROW_REFINEMENT_DEBOUNCE_MS,
  );

  const rowQuery = useQuery({
    queryKey: [
      ROWS_QUERY_KEY,
      selectedModel?.name,
      pagination.pageIndex,
      pagination.pageSize,
      debouncedTableRefinements.search.trim(),
      debouncedTableRefinements.filters.map(({ field, operator, value }) => ({
        field,
        operator,
        value,
      })),
      sorting.map(({ id, desc }) => ({ id, desc })),
    ],
    queryFn: ({ signal }) =>
      fetchModelRows(
        selectedModel?.name ?? "",
        signal,
        pagination.pageIndex + 1,
        pagination.pageSize,
        debouncedTableRefinements.search,
        debouncedTableRefinements.filters,
        sorting,
      ),
    enabled: Boolean(selectedModel?.name),
    placeholderData: keepPreviousData,
  });

  const rowErrorMessage =
    rowQuery.error instanceof Error
      ? rowQuery.error.message
      : selectedModel
        ? `Could not load rows for ${selectedModel.name}.`
        : "Could not load rows.";
  const rowState: RowLoadState = !selectedModel
    ? { status: "idle", rows: [], error: null }
    : rowQuery.isError
      ? { status: "error", rows: [], error: rowErrorMessage }
      : rowQuery.isFetching
        ? { status: "loading", rows: rowQuery.data?.rows ?? [], error: null }
        : { status: "success", rows: rowQuery.data?.rows ?? [], error: null };

  useEffect(() => {
    if (rowQuery.isSuccess && !rowQuery.isPlaceholderData) {
      setLoadedTableRefinements(debouncedTableRefinements);
    }
  }, [
    debouncedTableRefinements,
    rowQuery.dataUpdatedAt,
    rowQuery.isPlaceholderData,
    rowQuery.isSuccess,
  ]);

  useEffect(() => {
    if (!rowQuery.isError) return;
    toast.error("Could not load rows", {
      description: rowErrorMessage,
    });
  }, [rowErrorMessage, rowQuery.isError]);

  const hasTableRefinements =
    loadedTableRefinements.search.trim().length > 0 ||
    loadedTableRefinements.filters.length > 0;
  const hasPendingTableRefinements =
    tableSearch.trim().length > 0 || activeTableFilters.length > 0;
  const filteredRows = useMemo<TableRow[]>(() => {
    const query = loadedTableRefinements.search.trim().toLowerCase();

    return rowState.rows
      .map((row, rowIndex) => ({ row, rowIndex }))
      .filter(({ row }) => {
        const matchesSearch =
          !query ||
          tableFields.some((field) => normalizeSearchValue(row[field.name]).includes(query));

        return (
          matchesSearch &&
          loadedTableRefinements.filters.every((filter) => rowMatchesFilter(row, filter))
        );
      });
  }, [loadedTableRefinements, rowState.rows, tableFields]);
  const tableColumns = useMemo<ColumnDef<TableRow>[]>(
    () =>
      tableFields.map((field) => ({
        id: field.name,
        accessorFn: ({ row }) => row[field.name],
        enableSorting: true,
        header: ({ column }) => {
          const sortDirection = column.getIsSorted();
          return (
            <button
              type="button"
              onClick={column.getToggleSortingHandler()}
              aria-label={`Sort by ${field.name}`}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-foreground">{field.name}</span>
                <span className="block truncate font-mono text-[10px] font-normal text-muted-foreground">
                  {formatFieldType(field)}
                </span>
              </span>
              {sortDirection === "asc" ? (
                <ArrowUp className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              ) : sortDirection === "desc" ? (
                <ArrowDown className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              ) : (
                <ArrowUpDown
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        },
        cell: ({ getValue }) => {
          const value = getValue();
          const tone = getCellTone(value);
          return (
            <span
              title={formatValue(value)}
              className={cn(
                "block max-h-5 truncate font-mono text-[11px] leading-5",
                tone === "null" && "text-muted-foreground italic",
                tone === "number" && "text-primary",
                tone === "boolean" && "text-success",
                tone === "date" && "text-muted-foreground",
                tone === "json" && "text-code",
              )}
            >
              {formatValue(value)}
            </span>
          );
        },
      })),
    [tableFields],
  );
  const table = useReactTable({
    data: filteredRows,
    columns: tableColumns,
    state: {
      columnFilters,
      globalFilter: tableSearch,
      pagination,
      sorting,
    },
    onPaginationChange: setPagination,
    onSortingChange: (updater) => {
      resetTablePage();
      setSorting((current) =>
        typeof updater === "function" ? updater(current) : updater,
      );
    },
    getCoreRowModel: getCoreRowModel(),
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    pageCount: -1,
  });
  const tableColumnCount = Math.max(table.getAllLeafColumns().length, 1);
  const canGoToPreviousPage = pagination.pageIndex > 0 && rowState.status !== "loading";
  const canGoToNextPage =
    rowState.status !== "loading" &&
    !rowQuery.isPlaceholderData &&
    rowState.rows.length === pagination.pageSize;
  const selectedRow =
    selectedRowIndex === null ? null : (rowState.rows[selectedRowIndex] ?? null);

  useEffect(() => {
    setTableSearch((current) => (current ? "" : current));
    setTableFilters((current) => (current.length > 0 ? [] : current));
    setLoadedTableRefinements({ search: "", filters: [] });
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
    setSorting([]);
    setSelectedRowIndex(null);
  }, [selectedModel?.name]);

  useEffect(() => {
    setSelectedRowIndex(null);
  }, [pagination.pageIndex, pagination.pageSize]);

  useEffect(() => {
    if (
      selectedRowIndex !== null &&
      hasTableRefinements &&
      !filteredRows.some((item) => item.rowIndex === selectedRowIndex)
    ) {
      setSelectedRowIndex(null);
    }
  }, [filteredRows, hasTableRefinements, selectedRowIndex]);

  function resetTablePage() {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
  }

  function selectModel(modelName: string) {
    void navigate({ to: "/model/$modelName", params: { modelName } });
  }

  function refreshRows() {
    if (!selectedModel) return;
    void rowQuery.refetch();
  }

  function addTableFilter() {
    const defaultField = filterableFields[0];
    if (!defaultField) return;
    resetTablePage();
    const operator = operatorsForField(defaultField)[0]?.value ?? "equals";
    const value =
      defaultField.kind === "enum" && operator === "equals"
        ? enumValuesForField(defaultField)[0] ?? ""
        : "";
    setTableFilters((current) => [
      ...current,
      createTableFilter(defaultField.name, operator, value),
    ]);
  }

  function updateTableFilter(id: string, updates: Partial<TableFilter>) {
    resetTablePage();
    setTableFilters((current) =>
      current.map((filter) =>
        filter.id === id
          ? {
              ...filter,
              ...updates,
            }
          : filter,
      ),
    );
  }

  function removeTableFilter(id: string) {
    resetTablePage();
    setTableFilters((current) => current.filter((filter) => filter.id !== id));
  }

  function updateTableFilterField(id: string, fieldName: string) {
    resetTablePage();
    const field = filterableFields.find((candidate) => candidate.name === fieldName);
    const supportedOperators = operatorsForField(field);
    const enumValues = enumValuesForField(field);
    setTableFilters((current) =>
      current.map((filter) => {
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
    );
  }

  function clearTableRefinements() {
    resetTablePage();
    setTableSearch("");
    setTableFilters([]);
  }

  function updatePreviewMode(value: string) {
    if (value === "fields" || value === "json") {
      setPreviewMode(value);
    }
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground shadow-tool">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface/95 px-3 backdrop-blur">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-elevated shadow-sm">
            <Database className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">Prisma Viewer</h1>
            <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
              read-only local database viewer
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded border border-border bg-elevated px-2 py-1 font-mono text-[11px] font-medium text-muted-foreground sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
            Read-only
          </span>
          <Button
            variant="outline"
            type="button"
            onClick={refreshRows}
            disabled={!selectedModel || rowState.status === "loading"}
            aria-label={
              selectedModel ? `Refresh ${selectedModel.name} rows` : "Refresh rows"
            }
          >
            <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden border-t border-border/70 lg:grid-cols-[240px_minmax(460px,1fr)_360px]">
        <aside className="flex min-h-0 flex-col border-b border-border bg-panel lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-border bg-surface/60 p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search models"
                className="h-8 w-full rounded-md border border-input bg-elevated pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
          <nav className="min-h-0 flex-1 max-h-52 overflow-auto p-2 lg:max-h-none">
            {modelState.status === "loading" ? (
              <div className="rounded-md border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
                Loading models...
              </div>
            ) : modelState.status === "error" ? (
              <div className="rounded-md border border-dashed border-danger/70 bg-surface p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Could not load models.</p>
                <p className="mt-1">{modelState.error}</p>
              </div>
            ) : models.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
                No Prisma models found.
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
                No models match your search.
              </div>
            ) : null}
            {filteredModels.map((model) => (
              <button
                key={model.name}
                type="button"
                onClick={() => selectModel(model.name)}
                aria-label={`${model.name} model, ${model.fields.length} fields`}
                aria-current={selectedModel?.name === model.name ? "true" : undefined}
                className={cn(
                  "mb-1 grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-border hover:bg-elevated hover:text-foreground",
                  selectedModel?.name === model.name &&
                    "border-border bg-elevated text-primary shadow-sm",
                )}
              >
                <span className="min-w-0 truncate font-medium">{model.name}</span>
                <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {model.fields.length}
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-border bg-surface lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-border bg-panel/80 px-3 py-2">
            <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">
                  {!isModelRoute ? "Models" : (selectedModel?.name ?? "Model not found")}
                </h2>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {!isModelRoute
                    ? `${models.length} ${models.length === 1 ? "model" : "models"} available`
                    : selectedModel
                    ? formatRowSummary(
                        rowState,
                        tableFields.length,
                        filteredRows.length,
                        hasTableRefinements,
                      )
                    : "Load metadata to inspect model fields"}
                </p>
              </div>
              {hasPendingTableRefinements ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearTableRefinements}
                  aria-label="Clear table search and filters"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Clear
                </Button>
              ) : null}
            </div>

            {isModelRoute ? (
              <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={tableSearch}
                    onChange={(event) => {
                      resetTablePage();
                      setTableSearch(event.target.value);
                    }}
                    placeholder="Search rows across visible columns"
                    disabled={!selectedModel}
                    aria-label="Search table rows"
                    className="h-8 w-full rounded-md border border-input bg-elevated pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring disabled:opacity-50"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={addTableFilter}
                  disabled={!selectedModel || filterableFields.length === 0}
                  aria-label="Add table filter"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Filter
                </Button>
              </div>

              {tableFilters.length > 0 ? (
                <div
                  className="flex max-h-28 flex-col gap-1.5 overflow-auto"
                  aria-label="Table filters"
                >
                  {tableFilters.map((filter) => {
                    const field = filterableFields.find(
                      (candidate) => candidate.name === filter.field,
                    );
                    const supportedOperators = operatorsForField(field);
                    const operator = supportedOperators.find(
                      (item) => item.value === filter.operator,
                    );
                    const enumValues = enumValuesForField(field);
                    const shouldUseEnumValueSelect =
                      field?.kind === "enum" &&
                      operator?.needsValue !== false &&
                      enumValues.length > 0;
                    return (
                      <div
                        key={filter.id}
                        className="grid grid-cols-[minmax(7rem,1fr)_minmax(7rem,1fr)_minmax(8rem,1.4fr)_2rem] gap-1.5"
                      >
                        <label className="sr-only" htmlFor={`${filter.id}-field`}>
                          Filter field
                        </label>
                        <select
                          id={`${filter.id}-field`}
                          value={filter.field}
                          onChange={(event) =>
                            updateTableFilterField(filter.id, event.target.value)
                          }
                          className="h-8 min-w-0 rounded-md border border-input bg-elevated px-2 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                        >
                          {filterableFields.map((field) => (
                            <option key={field.name} value={field.name}>
                              {field.name}
                            </option>
                          ))}
                        </select>
                        <label className="sr-only" htmlFor={`${filter.id}-operator`}>
                          Filter operator
                        </label>
                        <select
                          id={`${filter.id}-operator`}
                          value={operator?.value ?? supportedOperators[0]?.value ?? "equals"}
                          onChange={(event) =>
                            updateTableFilter(filter.id, {
                              operator: event.target.value as FilterOperator,
                              value:
                                field?.kind === "enum" && event.target.value === "equals"
                                  ? enumValues[0] ?? filter.value
                                  : filter.value,
                            })
                          }
                          className="h-8 min-w-0 rounded-md border border-input bg-elevated px-2 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                        >
                          {supportedOperators.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                        <label className="relative min-w-0" htmlFor={`${filter.id}-value`}>
                          <Filter className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          {shouldUseEnumValueSelect ? (
                            <select
                              id={`${filter.id}-value`}
                              value={
                                enumValues.includes(filter.value) ? filter.value : enumValues[0]
                              }
                              onChange={(event) =>
                                updateTableFilter(filter.id, { value: event.target.value })
                              }
                              aria-label="Filter value"
                              className="h-8 w-full rounded-md border border-input bg-elevated pl-7 pr-2 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                            >
                              {enumValues.map((value) => (
                                <option key={value} value={value}>
                                  {value}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={`${filter.id}-value`}
                              value={filter.value}
                              onChange={(event) =>
                                updateTableFilter(filter.id, { value: event.target.value })
                              }
                              placeholder={operator?.needsValue === false ? "No value" : "Value"}
                              disabled={operator?.needsValue === false}
                              aria-label="Filter value"
                              className="h-8 w-full rounded-md border border-input bg-elevated pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring disabled:text-muted-foreground disabled:opacity-60"
                            />
                          )}
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeTableFilter(filter.id)}
                          aria-label="Remove table filter"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {!isModelRoute ? (
              <div className="p-3">
                {modelState.status === "loading" ? (
                  <div className="rounded-md border border-dashed border-border bg-panel p-6 text-center text-xs text-muted-foreground">
                    Loading models...
                  </div>
                ) : modelState.status === "error" ? (
                  <div className="rounded-md border border-dashed border-danger/70 bg-panel p-6 text-center text-xs text-muted-foreground">
                    <p className="font-medium text-danger">Could not load models.</p>
                    <p className="mt-1">{modelState.error}</p>
                  </div>
                ) : models.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-panel p-6 text-center text-xs text-muted-foreground">
                    No Prisma models found.
                  </div>
                ) : (
                  <table className="w-full table-fixed border-collapse text-left text-xs">
                    <thead className="bg-panel">
                      <tr>
                        <th className="border-b border-r border-border px-3 py-2 font-medium text-muted-foreground">
                          Model
                        </th>
                        <th className="w-24 border-b border-r border-border px-3 py-2 font-medium text-muted-foreground">
                          Fields
                        </th>
                        <th className="w-24 border-b border-r border-border px-3 py-2 font-medium text-muted-foreground">
                          Scalars
                        </th>
                        <th className="w-24 border-b border-r border-border px-3 py-2 font-medium text-muted-foreground">
                          Relations
                        </th>
                        <th className="w-24 border-b border-border px-3 py-2 font-medium text-muted-foreground">
                          Enums
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {models.map((model) => {
                        const scalarCount = model.fields.filter(
                          (field) => field.kind === "scalar",
                        ).length;
                        const relationCount = model.fields.filter(
                          (field) => field.kind === "object",
                        ).length;
                        const enumCount = model.fields.filter(
                          (field) => field.kind === "enum",
                        ).length;

                        return (
                          <tr
                            key={model.name}
                            className="h-10 border-b border-border transition-colors hover:bg-elevated"
                          >
                            <td className="border-r border-border px-3 py-1.5">
                              <Link
                                to="/model/$modelName"
                                params={{ modelName: model.name }}
                                className="block truncate font-medium text-primary hover:underline"
                              >
                                {model.name}
                              </Link>
                            </td>
                            <td className="border-r border-border px-3 py-1.5 font-mono text-muted-foreground">
                              {model.fields.length}
                            </td>
                            <td className="border-r border-border px-3 py-1.5 font-mono text-muted-foreground">
                              {scalarCount}
                            </td>
                            <td className="border-r border-border px-3 py-1.5 font-mono text-muted-foreground">
                              {relationCount}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-muted-foreground">
                              {enumCount}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ) : selectedModel ? (
              <table className="w-max min-w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-panel">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className="min-w-[150px] border-b border-r border-border px-3 py-2 font-medium text-muted-foreground last:border-r-0"
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {rowState.status === "loading" && rowState.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={tableColumnCount}
                        className="h-28 px-3 text-center text-xs text-muted-foreground"
                      >
                        Loading rows...
                      </td>
                    </tr>
                  ) : rowState.status === "error" ? (
                    <tr>
                      <td
                        colSpan={tableColumnCount}
                        className="h-28 px-3 text-center text-xs text-muted-foreground"
                      >
                        <p className="font-medium text-danger">Could not load rows.</p>
                        <p className="mt-1">{rowState.error}</p>
                      </td>
                    </tr>
                  ) : rowState.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={tableColumnCount}
                        className="h-28 px-3 text-center text-xs text-muted-foreground"
                      >
                        No rows found for this model.
                      </td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={tableColumnCount}
                        className="h-28 px-3 text-center text-xs text-muted-foreground"
                      >
                        No rows match the current search or filters.
                      </td>
                    </tr>
                  ) : (
                    table.getRowModel().rows.map((tableRow) => (
                      <tr
                        key={tableRow.original.rowIndex}
                        aria-label={`Select row ${tableRow.original.rowIndex + 1}`}
                        aria-selected={
                          selectedRowIndex === tableRow.original.rowIndex ? "true" : undefined
                        }
                        onClick={() => setSelectedRowIndex(tableRow.original.rowIndex)}
                        className={cn(
                          "h-10 cursor-pointer border-b border-border transition-colors hover:bg-elevated",
                          selectedRowIndex === tableRow.original.rowIndex &&
                            "bg-accent/15 shadow-row hover:bg-accent/15",
                        )}
                      >
                        {tableRow.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className="min-w-[150px] border-r border-border px-3 py-1.5 last:border-r-0"
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
                {modelState.status === "loading"
                  ? "Loading models..."
                  : `Model "${routedModelName}" was not found.`}
              </div>
            )}
          </div>

          {isModelRoute ? (
            <div className="flex min-h-11 shrink-0 flex-col gap-2 border-t border-border bg-panel/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">Page {pagination.pageIndex + 1}</span>
                {rowState.status === "loading" && rowState.rows.length > 0 ? (
                  <span>Loading...</span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Rows
                  <select
                    value={pagination.pageSize}
                    onChange={(event) => {
                      table.setPageSize(Number(event.target.value));
                      table.setPageIndex(0);
                    }}
                    disabled={!selectedModel}
                    aria-label="Rows per page"
                    className="h-8 rounded-md border border-input bg-elevated px-2 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring disabled:opacity-50"
                  >
                    {TABLE_PAGE_SIZE_OPTIONS.map((pageSize) => (
                      <option key={pageSize} value={pageSize}>
                        {pageSize}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => table.previousPage()}
                  disabled={!selectedModel || !canGoToPreviousPage}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => table.nextPage()}
                  disabled={!selectedModel || !canGoToNextPage}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="flex min-h-0 flex-col bg-panel">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-surface/70 px-3">
            <div className="flex min-w-0 items-center gap-2">
              <TableProperties className="h-4 w-4 text-primary" />
              <h2 className="truncate text-sm font-semibold">Record Preview</h2>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {selectedRow ? (
              <>
                <Tabs value={previewMode} onValueChange={updatePreviewMode}>
                  <TabsList className="mb-3">
                    <TabsTrigger
                      value="fields"
                      currentValue={previewMode}
                      onValueChange={updatePreviewMode}
                    >
                      Fields
                    </TabsTrigger>
                    <TabsTrigger
                      value="json"
                      currentValue={previewMode}
                      onValueChange={updatePreviewMode}
                    >
                      <span className="inline-flex items-center gap-1">
                        <FileJson className="h-3 w-3" />
                        JSON
                      </span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {previewMode === "fields" ? (
                  <dl className="max-h-full overflow-auto rounded-md border border-border bg-surface">
                    {tableFields.map((field) => (
                      <div
                        key={field.name}
                        className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-border last:border-b-0"
                      >
                        <dt className="border-r border-border bg-panel px-2 py-2">
                          <span className="block truncate text-xs font-medium">
                            {field.name}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">
                            {formatFieldType(field)}
                          </span>
                        </dt>
                        <dd className="min-w-0 px-2 py-2 font-mono text-[11px] leading-5">
                          <span
                            title={formatValue(selectedRow[field.name])}
                            className={cn(
                              "block break-words",
                              selectedRow[field.name] === null &&
                                "text-muted-foreground",
                            )}
                          >
                            {formatValue(selectedRow[field.name])}
                          </span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <pre
                    aria-label="Selected record JSON preview"
                    className="max-h-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-3 font-mono text-[11px] leading-5 text-code"
                  >
                    {formatJsonPreview(selectedRow)}
                  </pre>
                )}
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-surface p-6 text-center text-xs text-muted-foreground">
                Select a table row to inspect the full record.
              </div>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
