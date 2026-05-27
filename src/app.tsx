import {
  ChevronDown,
  Columns3,
  Database,
  FileJson,
  RefreshCcw,
  Search,
  TableProperties,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { cn } from "./lib/utils";

type Field = {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
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

function formatRowSummary(rowState: RowLoadState, columnCount: number) {
  const columnLabel = columnCount === 1 ? "column" : "columns";

  if (rowState.status === "loading") {
    return `Loading rows, ${columnCount} ${columnLabel} shown`;
  }

  if (rowState.status === "error") {
    return `Rows unavailable, ${columnCount} ${columnLabel} shown`;
  }

  const rowLabel = rowState.rows.length === 1 ? "row" : "rows";
  return `${rowState.rows.length} ${rowLabel} loaded, ${columnCount} ${columnLabel} shown`;
}

async function fetchModelMetadata(signal: AbortSignal): Promise<Model[]> {
  const response = await fetch("/api/models", { signal });

  if (!response.ok) {
    throw new Error(`Metadata API returned ${response.status}`);
  }

  const body = (await response.json()) as MetadataResponse;
  return body.models;
}

async function fetchModelRows(
  modelName: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `/api/models/${encodeURIComponent(modelName)}/rows?page=1&pageSize=50`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(`Rows API returned ${response.status}`);
  }

  const body = (await response.json()) as RowsResponse;
  return body.rows;
}

export function App() {
  const [search, setSearch] = useState("");
  const [modelState, setModelState] = useState<ModelLoadState>({
    status: "loading",
    models: [],
    error: null,
  });
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [rowState, setRowState] = useState<RowLoadState>({
    status: "idle",
    rows: [],
    error: null,
  });
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState("fields");

  useEffect(() => {
    const controller = new AbortController();

    setModelState({ status: "loading", models: [], error: null });
    fetchModelMetadata(controller.signal)
      .then((models) => {
        setModelState({ status: "success", models, error: null });
        setSelectedModelName((current) => current ?? models[0]?.name ?? null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof Error
            ? error.message
            : "Could not load Prisma model metadata.";
        setModelState({ status: "error", models: [], error: message });
        setSelectedModelName(null);
      });

    return () => controller.abort();
  }, []);

  const models = modelState.models;
  const filteredModels = useMemo(
    () =>
      models.filter((model) =>
        model.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [models, search],
  );

  const selectedModel =
    models.find((model) => model.name === selectedModelName) ?? models[0] ?? null;
  const tableFields = useMemo(
    () =>
      selectedModel?.fields.filter(
        (field) => field.kind === "scalar" || field.kind === "enum",
      ) ?? [],
    [selectedModel],
  );
  const selectedRow =
    selectedRowIndex === null ? null : (rowState.rows[selectedRowIndex] ?? null);

  useEffect(() => {
    if (!selectedModel?.name) {
      setRowState({ status: "idle", rows: [], error: null });
      setSelectedRowIndex(null);
      return;
    }

    const controller = new AbortController();
    const modelName = selectedModel.name;

    setRowState({ status: "loading", rows: [], error: null });
    setSelectedRowIndex(null);
    fetchModelRows(modelName, controller.signal)
      .then((rows) => {
        setRowState({ status: "success", rows, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof Error ? error.message : `Could not load rows for ${modelName}.`;
        setRowState({ status: "error", rows: [], error: message });
      });

    return () => controller.abort();
  }, [selectedModel?.name]);

  function selectModel(modelName: string) {
    setSelectedModelName(modelName);
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Database className="h-4 w-4 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">Prisma Viewer</h1>
            <p className="truncate text-xs text-muted-foreground">
              local development database
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" type="button">
            <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[240px_minmax(460px,1fr)_360px]">
        <aside className="min-h-0 border-b border-border bg-muted/45 lg:border-b-0 lg:border-r">
          <div className="border-b border-border p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search models"
                className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
          <nav className="max-h-52 overflow-auto p-2 lg:max-h-none">
            {modelState.status === "loading" ? (
              <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                Loading models...
              </div>
            ) : modelState.status === "error" ? (
              <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Could not load models.</p>
                <p className="mt-1">{modelState.error}</p>
              </div>
            ) : models.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                No Prisma models found.
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
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
                  "mb-1 grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-background",
                  selectedModel?.name === model.name &&
                    "bg-background text-primary shadow-sm ring-1 ring-border",
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

        <section className="min-w-0 overflow-hidden border-b border-border bg-background lg:border-b-0 lg:border-r">
          <div className="flex h-11 items-center justify-between border-b border-border px-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">
                {selectedModel?.name ?? "No model selected"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {selectedModel
                  ? formatRowSummary(rowState, tableFields.length)
                  : "Load metadata to inspect model fields"}
              </p>
            </div>
            <Button variant="ghost" size="icon" type="button" aria-label="Columns">
              <Columns3 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="h-[45vh] overflow-auto lg:h-[calc(100vh-5.75rem)]">
            {selectedModel ? (
              <table className="min-w-[720px] border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    {tableFields.map((field) => (
                      <th
                        key={field.name}
                        className="w-44 max-w-44 border-b border-r border-border px-3 py-2 font-medium text-muted-foreground last:border-r-0"
                      >
                        <span className="block truncate">{field.name}</span>
                        <span className="block truncate font-mono text-[10px] font-normal">
                          {formatFieldType(field)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowState.status === "loading" ? (
                    <tr>
                      <td
                        colSpan={Math.max(tableFields.length, 1)}
                        className="h-28 px-3 text-center text-xs text-muted-foreground"
                      >
                        Loading rows...
                      </td>
                    </tr>
                  ) : rowState.status === "error" ? (
                    <tr>
                      <td
                        colSpan={Math.max(tableFields.length, 1)}
                        className="h-28 px-3 text-center text-xs text-muted-foreground"
                      >
                        <p className="font-medium text-foreground">Could not load rows.</p>
                        <p className="mt-1">{rowState.error}</p>
                      </td>
                    </tr>
                  ) : rowState.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={Math.max(tableFields.length, 1)}
                        className="h-28 px-3 text-center text-xs text-muted-foreground"
                      >
                        No rows found for this model.
                      </td>
                    </tr>
                  ) : (
                    rowState.rows.map((row, rowIndex) => (
                      <tr
                        key={rowIndex}
                        aria-label={`Select row ${rowIndex + 1}`}
                        aria-selected={selectedRowIndex === rowIndex ? "true" : undefined}
                        onClick={() => setSelectedRowIndex(rowIndex)}
                        className={cn(
                          "h-10 cursor-pointer border-b border-border hover:bg-muted/55",
                          selectedRowIndex === rowIndex && "bg-accent/60 hover:bg-accent/60",
                        )}
                      >
                        {tableFields.map((field) => {
                          const value = row[field.name];
                          const tone = getCellTone(value);
                          return (
                            <td
                              key={field.name}
                              className="w-44 max-w-44 border-r border-border px-3 py-1.5 last:border-r-0"
                            >
                              <span
                                title={formatValue(value)}
                                className={cn(
                                  "block max-h-5 truncate font-mono text-[11px] leading-5",
                                  tone === "null" && "text-muted-foreground italic",
                                  tone === "number" && "text-primary",
                                  tone === "boolean" && "text-accent-foreground",
                                  tone === "date" && "text-muted-foreground",
                                  tone === "json" && "text-foreground",
                                )}
                              >
                                {formatValue(value)}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
                Select a model after metadata loads.
              </div>
            )}
          </div>
        </section>

        <aside className="min-h-0 bg-muted/35">
          <div className="flex h-11 items-center justify-between border-b border-border px-3">
            <div className="flex min-w-0 items-center gap-2">
              <TableProperties className="h-4 w-4 text-primary" />
              <h2 className="truncate text-sm font-semibold">Record Preview</h2>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="p-3">
            {selectedRow ? (
              <>
                <Tabs value={previewMode} onValueChange={setPreviewMode}>
                  <TabsList className="mb-3">
                    <TabsTrigger
                      value="fields"
                      currentValue={previewMode}
                      onValueChange={setPreviewMode}
                    >
                      Fields
                    </TabsTrigger>
                    <TabsTrigger
                      value="json"
                      currentValue={previewMode}
                      onValueChange={setPreviewMode}
                    >
                      <span className="inline-flex items-center gap-1">
                        <FileJson className="h-3 w-3" />
                        JSON
                      </span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {previewMode === "fields" ? (
                  <dl className="max-h-[34rem] overflow-auto rounded-md border border-border bg-background">
                    {tableFields.map((field) => (
                      <div
                        key={field.name}
                        className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-border last:border-b-0"
                      >
                        <dt className="border-r border-border bg-muted px-2 py-2">
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
                  <pre className="max-h-[34rem] overflow-auto rounded-md border border-border bg-background p-3 text-[11px] leading-5">
                    {JSON.stringify(selectedRow, null, 2)}
                  </pre>
                )}
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-background p-6 text-center text-xs text-muted-foreground">
                Select a table row to inspect the full record.
              </div>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
