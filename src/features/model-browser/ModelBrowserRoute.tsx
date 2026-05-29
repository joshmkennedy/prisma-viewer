import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type PaginationState, type SortingState, type Updater } from "@tanstack/react-table";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Code2, Filter, Plus, RefreshCcw, Search, TableProperties, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSidebarLayout } from "../../app/sidebar-layout-store";
import {
  WorkspaceCenter,
  WorkspaceContentHeader,
  WorkspaceLayout,
  WorkspacePanelHeader,
  WorkspaceSidebar,
} from "../../app/WorkspaceLayout";
import { Button } from "../../components/ui/button";
import { SidebarToggleButton } from "../../components/ui/sidebar-toggle-button";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { fetchModelMetadata, fetchModelRows } from "../../api/prisma-pad-client";
import type { Model } from "../../domain/prisma-metadata";
import { formatFieldType, formatJsonBlock, formatValue, getCellTone } from "../../domain/row-formatting";
import { RecordPreview } from "../record-preview/RecordPreview";
import type { PreviewMode } from "../record-preview/record-preview-model";
import { QueryInspectorPanel } from "../query-inspector/QueryInspectorPanel";
import { cn } from "../../lib/utils";
import { DEFAULT_TABLE_PAGE_SIZE, ROW_REFINEMENT_DEBOUNCE_MS, ROWS_QUERY_KEY, TABLE_PAGE_SIZE_OPTIONS, createModelTableBrowser, enumValuesForField, operatorsForField, type ModelRowsRequest, type TableFilter, type TableRefinements, type TableRow } from "./model-table-controller";
import {
  normalizeModelRouteSearch,
  validateModelRouteSearch,
  type FilterOperator,
  type ModelRouteSearchInput,
} from "./model-route-search";

type ModelLoadState =
  | { status: "loading"; models: Model[]; error: null }
  | { status: "success"; models: Model[]; error: null }
  | { status: "error"; models: Model[]; error: string };

type RowLoadState =
  | { status: "idle"; rows: Record<string, unknown>[]; error: null }
  | { status: "loading"; rows: Record<string, unknown>[]; error: null }
  | { status: "success"; rows: Record<string, unknown>[]; error: null }
  | { status: "error"; rows: Record<string, unknown>[]; error: string };

type ContextPanelMode = "record" | "query";

function tableColumnCountForModel(model: Model) {
  return model.fields.filter((field) => field.kind === "scalar" || field.kind === "enum")
    .length;
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

function tableRefinementsEqual(left: TableRefinements, right: TableRefinements) {
  return (
    left.search === right.search &&
    left.filters.length === right.filters.length &&
    left.filters.every((filter, index) => {
      const other = right.filters[index];
      return (
        other &&
        filter.field === other.field &&
        filter.operator === other.operator &&
        filter.value === other.value
      );
    })
  );
}

export { validateModelRouteSearch };

export function ModelBrowserRoute({
  routedModelName,
  rawRouteSearch = {},
}: {
  routedModelName: string | null;
  rawRouteSearch?: ModelRouteSearchInput;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [loadedTableRefinements, setLoadedTableRefinements] = useState<TableRefinements>({
    search: "",
    filters: [],
  });
  const [previewMode, setPreviewMode] = useState<PreviewMode>("fields");
  const [contextPanelMode, setContextPanelMode] = useState<ContextPanelMode>("record");
  const {
    isLeftCollapsed,
    isRightCollapsed,
    expandRight: expandContextPanel,
    toggleLeft: toggleModelList,
    toggleRight: toggleContextPanel,
  } = useSidebarLayout("models");
  const [optimisticSelectedRowIndex, setOptimisticSelectedRowIndex] = useState<number | null>(
    null,
  );
  const routeSearch = useMemo(
    () => normalizeModelRouteSearch(rawRouteSearch),
    [rawRouteSearch],
  );

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

  const isModelRoute = routedModelName !== null;
  const requestBrowser = useMemo(
    () =>
      createModelTableBrowser({
        modelName: routedModelName,
        rawSearch: rawRouteSearch,
        models,
        rows: [],
        rowStatus: "idle",
      }),
    [models, rawRouteSearch, routedModelName],
  );
  const selectedModel = requestBrowser.selectedModel;
  const pendingTableRefinements = requestBrowser.pendingRefinements;
  const debouncedTableRefinements = useDebouncedValue(
    pendingTableRefinements,
    ROW_REFINEMENT_DEBOUNCE_MS,
  );
  const rowRequest = useMemo(
    () =>
      requestBrowser.request
        ? {
            ...requestBrowser.request,
            search: debouncedTableRefinements.search,
            filters: debouncedTableRefinements.filters,
          }
        : null,
    [debouncedTableRefinements, requestBrowser.request],
  );

  const rowQuery = useQuery({
    queryKey: [
      ROWS_QUERY_KEY,
      rowRequest?.modelName,
      rowRequest?.page,
      rowRequest?.pageSize,
      rowRequest?.search.trim(),
      rowRequest?.filters.map(({ field, operator, value }) => ({
        field,
        operator,
        value,
      })),
      rowRequest?.sorting.map(({ id, desc }) => ({ id, desc })),
    ],
    queryFn: ({ signal }) => fetchModelRows(rowRequest as ModelRowsRequest, signal),
    enabled: Boolean(rowRequest),
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

  const tableBrowser = useMemo(
    () =>
      createModelTableBrowser({
        modelName: routedModelName,
        rawSearch: rawRouteSearch,
        models,
        rows: rowState.rows,
        rowStatus: rowState.status,
        loadedRefinements: loadedTableRefinements,
      }),
    [
      loadedTableRefinements,
      models,
      rawRouteSearch,
      routedModelName,
      rowState.rows,
      rowState.status,
    ],
  );
  const tableFields = tableBrowser.tableFields;
  const filterableFields = tableBrowser.filterableFields;
  const tableSearch = tableBrowser.routeSearch.search;
  const tableFilters = tableBrowser.tableFilters;
  const sorting = tableBrowser.sorting;
  const pagination = tableBrowser.pagination;
  const columnFilters = tableBrowser.columnFilters;
  const filteredRows = tableBrowser.visibleRows;
  const hasTableRefinements = tableBrowser.hasLoadedRefinements;
  const hasPendingTableRefinements = tableBrowser.hasPendingRefinements;
  const selectedRowIndex = optimisticSelectedRowIndex ?? tableBrowser.selectedRowIndex;
  const selectedRow =
    selectedRowIndex === null ? null : (rowState.rows[selectedRowIndex] ?? null);
  const activeContextPanelMode: ContextPanelMode =
    selectedRow === null ? "query" : contextPanelMode;

  useEffect(() => {
    setOptimisticSelectedRowIndex(null);
  }, [routeSearch.row, routeSearch.page, routeSearch.pageSize, routeSearch.search, routedModelName]);

  useEffect(() => {
    if (rowQuery.isSuccess && !rowQuery.isPlaceholderData) {
      setLoadedTableRefinements((current) =>
        tableRefinementsEqual(current, debouncedTableRefinements)
          ? current
          : debouncedTableRefinements,
      );
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
  const tableColumns = useMemo<ColumnDef<TableRow>[]>(
    () =>
      tableFields.map((field) => ({
        id: field.name,
        accessorFn: ({ row }) => row[field.name],
        enableSorting: true,
        header: ({ column }) => {
          const sortDirection = column.getIsSorted();
          const nextSort =
            sortDirection === "asc"
              ? [{ id: field.name, desc: true }]
              : sortDirection === "desc"
                ? []
                : [{ id: field.name, desc: false }];
          return (
            <button
              type="button"
              onClick={() => navigateModelSearch(tableBrowser.commands.changeSorting(nextSort))}
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
    [tableBrowser.commands, tableFields],
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
    onPaginationChange: handlePaginationChange,
    onSortingChange: handleSortingChange,
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
  const tableQueryInspector = rowQuery.isPlaceholderData ? null : rowQuery.data?.query ?? null;

  useEffect(() => {
    if (!selectedModel) return;
    if (
      tableBrowser.canonicalRouteSearch.filters.length !== routeSearch.filters.length ||
      tableBrowser.canonicalRouteSearch.sort.length !== routeSearch.sort.length ||
      tableBrowser.canonicalRouteSearch.row !== routeSearch.row
    ) {
      void navigate({
        to: "/model/$modelName",
        params: { modelName: routedModelName ?? "" },
        search: tableBrowser.canonicalSearch,
        replace: true,
      });
    }
  }, [
    navigate,
    routedModelName,
    routeSearch,
    selectedModel,
    tableBrowser.canonicalRouteSearch,
    tableBrowser.canonicalSearch,
  ]);

  function navigateModelSearch(
    search: ModelRouteSearchInput,
    options: { replace?: boolean } = {},
  ) {
    if (!routedModelName) return;
    void navigate({
      to: "/model/$modelName",
      params: { modelName: routedModelName },
      search,
      replace: options.replace ?? true,
    });
  }

  function handlePaginationChange(updater: Updater<PaginationState>) {
    const nextPagination =
      typeof updater === "function" ? updater(pagination) : updater;
    navigateModelSearch(tableBrowser.commands.changePagination(nextPagination));
  }

  function handleSortingChange(updater: Updater<SortingState>) {
    const nextSorting = typeof updater === "function" ? updater(sorting) : updater;
    navigateModelSearch(tableBrowser.commands.changeSorting(nextSorting));
  }

  function selectModel(modelName: string) {
    void navigate({ to: "/model/$modelName", params: { modelName } });
  }

  function refreshRows() {
    if (!selectedModel) return;
    void rowQuery.refetch();
  }

  function addTableFilter() {
    navigateModelSearch(tableBrowser.commands.addFilter());
  }

  function updateTableFilter(id: string, updates: Partial<TableFilter>) {
    navigateModelSearch(tableBrowser.commands.updateFilter(id, updates));
  }

  function removeTableFilter(id: string) {
    navigateModelSearch(tableBrowser.commands.removeFilter(id));
  }

  function updateTableFilterField(id: string, fieldName: string) {
    navigateModelSearch(tableBrowser.commands.updateFilterField(id, fieldName));
  }

  function clearTableRefinements() {
    navigateModelSearch(tableBrowser.commands.clearRefinements());
  }

  function selectTableRow(rowIndex: number) {
    setOptimisticSelectedRowIndex(rowIndex);
    setContextPanelMode("record");
    if (isRightCollapsed) {
      expandContextPanel();
    }
    navigateModelSearch(tableBrowser.commands.selectRow(rowIndex));
  }

  function updatePreviewMode(value: string) {
    if (value === "fields" || value === "json") {
      setPreviewMode(value);
    }
  }

  function updateContextPanelMode(value: string) {
    if (value === "record" || value === "query") {
      setContextPanelMode(value);
    }
  }

  return (
    <WorkspaceLayout
      activeRoute="models"
      isLeftCollapsed={isLeftCollapsed}
      isRightCollapsed={isRightCollapsed}
      onToggleLeft={toggleModelList}
      onToggleRight={toggleContextPanel}
      leftCollapsedLabel="Show models sidebar"
      leftExpandedLabel="Hide models sidebar"
      rightCollapsedLabel="Show record preview panel"
      rightExpandedLabel="Hide record preview panel"
      leftSidebar={
        <WorkspaceSidebar side="left">
          <WorkspacePanelHeader
            title="Model List"
            icon={<TableProperties className="h-4 w-4 text-primary" aria-hidden="true" />}
            actions={
              <SidebarToggleButton
                side="left"
                isCollapsed={false}
                collapsedLabel="Show models sidebar"
                expandedLabel="Hide models sidebar"
                onClick={toggleModelList}
              />
            }
          />
          <div className="flex h-13 shrink-0 items-center border-b border-border px-3">
            <label className="relative block min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search models"
                className="h-8 w-full rounded-md border border-input bg-elevated pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
          <nav className="min-h-0 flex-1 max-h-52 overflow-auto p-3 lg:max-h-none">
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
            {filteredModels.map((model) => {
              const columnCount = tableColumnCountForModel(model);
              return (
                <button
                  key={model.name}
                  type="button"
                  onClick={() => selectModel(model.name)}
                  aria-label={`${model.name} model, ${columnCount} columns`}
                  aria-current={selectedModel?.name === model.name ? "true" : undefined}
                  className={cn(
                    "mb-1 grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-elevated hover:text-foreground",
                    selectedModel?.name === model.name &&
                      "border-border bg-elevated text-primary shadow-sm",
                  )}
                >
                  <span className="min-w-0 truncate font-medium">{model.name}</span>
                  <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {columnCount}
                  </span>
                </button>
              );
            })}
          </nav>
        </WorkspaceSidebar>
      }
      rightSidebar={
        <WorkspaceSidebar side="right">
          <WorkspacePanelHeader
            title={activeContextPanelMode === "query" ? "Table Query" : "Record Preview"}
            icon={
              activeContextPanelMode === "query" ? (
                <Code2 className="h-4 w-4 text-primary" aria-hidden="true" />
              ) : (
                <TableProperties className="h-4 w-4 text-primary" aria-hidden="true" />
              )
            }
            actions={
              <>
                {selectedModel ? (
                  <Tabs value={activeContextPanelMode} onValueChange={updateContextPanelMode}>
                    <TabsList>
                      <TabsTrigger
                        value="record"
                        currentValue={activeContextPanelMode}
                        onValueChange={updateContextPanelMode}
                        aria-label="Show record preview"
                      >
                        Record
                      </TabsTrigger>
                      <TabsTrigger
                        value="query"
                        currentValue={activeContextPanelMode}
                        onValueChange={updateContextPanelMode}
                        aria-label="Show table query inspector"
                      >
                        Query
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                ) : null}
                <SidebarToggleButton
                  side="right"
                  isCollapsed={false}
                  collapsedLabel="Show record preview panel"
                  expandedLabel="Hide record preview panel"
                  onClick={toggleContextPanel}
                />
              </>
            }
          />

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {activeContextPanelMode === "query" ? (
              selectedModel ? (
                tableQueryInspector ? (
                  <QueryInspectorPanel
                    ariaLabel="Table Query Inspector"
                    heading="Table Query"
                    title={`${tableQueryInspector.model}.${tableQueryInspector.operation} via prisma.${tableQueryInspector.delegateName}`}
                    argsLabel="Args"
                    argsAriaLabel="Table query args"
                    argsJson={formatJsonBlock(tableQueryInspector.args)}
                    prismaCall={tableQueryInspector.prismaCall}
                    prismaCallAriaLabel="Table Prisma Client call"
                    notesLabel="Contributors"
                    notesAriaLabel="Table query contributors"
                    notes={tableQueryInspector.contributors.map((contributor) => contributor.label)}
                    layout="stack"
                    className="space-y-3"
                  />
                ) : rowState.status === "error" ? (
                  <div className="rounded-md border border-dashed border-danger/70 bg-surface p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-danger">Table query unavailable.</p>
                    <p className="mt-1">{rowState.error}</p>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
                    Loading table query...
                  </div>
                )
              ) : (
                <div className="rounded-md border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground">
                  Select a model to inspect its table query.
                </div>
              )
            ) : (
              <RecordPreview
                record={selectedRow}
                fields={tableFields}
                previewMode={previewMode}
                onPreviewModeChange={updatePreviewMode}
                emptyMessage="Select a table row to inspect the full record."
              />
            )}
          </div>
        </WorkspaceSidebar>
      }
    >
      <WorkspaceCenter>
        <WorkspaceContentHeader
          isLeftCollapsed={isLeftCollapsed}
          isRightCollapsed={isRightCollapsed}
        >
            <div
              className={cn(
                "flex w-full items-center justify-between gap-3",
              )}
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <h2 className="shrink-0 truncate text-sm font-semibold">
                  {!isModelRoute ? "Models" : (selectedModel?.name ?? "Model not found")}
                </h2>
                <p className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                  {!isModelRoute
                    ? `${models.length} ${models.length === 1 ? "model" : "models"} available`
                    : selectedModel
                    ? tableBrowser.summary
                    : "Load metadata to inspect model fields"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedModel ? (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={refreshRows}
                    disabled={rowState.status === "loading"}
                    aria-label={`Refresh ${selectedModel.name} rows`}
                    title={`Refresh ${selectedModel.name} rows`}
                    className="w-7 px-0"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
                {selectedModel ? (
                  <Link
                    to="/query-lab/$modelName"
                    params={{ modelName: selectedModel.name }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-elevated font-mono text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    aria-label={`Open Query Lab for ${selectedModel.name}`}
                    title={`Open Query Lab for ${selectedModel.name}`}
                  >
                    <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                ) : null}
                {hasPendingTableRefinements ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={clearTableRefinements}
                    aria-label="Clear table search and filters"
                    title="Clear table search and filters"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </div>
        </WorkspaceContentHeader>

        {isModelRoute ? (
          <div className="flex h-13 shrink-0 flex-col justify-center gap-2 border-b border-border bg-panel/80 px-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={tableSearch}
                  onChange={(event) => {
                    navigateModelSearch(tableBrowser.commands.searchRows(event.target.value));
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
                size="icon"
                onClick={addTableFilter}
                disabled={!selectedModel || filterableFields.length === 0}
                aria-label="Add table filter"
                title="Add table filter"
                className="h-8 w-8"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
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
                        title="Remove table filter"
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
                          Columns
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
                        const columnCount = tableColumnCountForModel(model);
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
                              {columnCount}
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
                        onClick={() => selectTableRow(tableRow.original.rowIndex)}
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
                      navigateModelSearch(
                        tableBrowser.commands.setPageSize(Number(event.target.value)),
                      );
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
                  title="Previous page"
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
                  title="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}
      </WorkspaceCenter>
    </WorkspaceLayout>
  );
}
