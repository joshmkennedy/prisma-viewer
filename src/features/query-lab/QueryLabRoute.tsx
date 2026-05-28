import { useMutation, useQuery } from "@tanstack/react-query";
import Editor, { type BeforeMount, type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { Link, useNavigate } from "@tanstack/react-router";
import { Code2, Copy, Database, FileJson, Pencil, Play, Save, TableProperties, Trash2, TriangleAlert } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { fetchModelMetadata } from "../../api/prisma-pad-client";
import { previewQueryLab } from "../../api/query-lab-client";
import { formatFieldType, formatValue } from "../../domain/row-formatting";
import { RecordPreview } from "../record-preview/RecordPreview";
import type { PreviewMode } from "../record-preview/record-preview-model";
import { cn } from "../../lib/utils";
import { formatQueryLabArgsSource } from "../../query-lab-args-format";
import { type QueryLabAssistContext } from "../../query-lab-editor-assist";
import { QUERY_LAB_OPERATIONS, createQueryLabResultViewModel, isQueryLabOperation, type QueryLabOperation, type QueryLabResultMode } from "./query-lab-result-presenter";
import { QUERY_LAB_LANGUAGE_ID, QUERY_LAB_THEME_ID, disposeQueryLabCompletionProvider, registerQueryLabCompletionProvider, registerQueryLabLanguage, setQueryLabEditorMarkers } from "./query-lab-monaco";
import { createSavedQueryLabViewId, deleteSavedQueryLabView as deleteSavedQueryLabViewCommand, loadSavedQueryLabViews, openSavedQueryLabView as openSavedQueryLabViewCommand, persistSavedQueryLabViews, renameSavedQueryLabView as renameSavedQueryLabViewCommand, saveSavedQueryLabView, type SavedQueryLabView } from "./query-lab-saved-views";

const QUERY_LAB_DEFAULT_ARGS = "{}";

export function QueryLabRoute({ initialModelName }: { initialModelName: string | null }) {
  const navigate = useNavigate();
  const [selectedModelName, setSelectedModelName] = useState(initialModelName ?? "");
  const [operation, setOperation] = useState<QueryLabOperation>("findMany");
  const [argsSource, setArgsSource] = useState(QUERY_LAB_DEFAULT_ARGS);
  const [resultMode, setResultMode] = useState<QueryLabResultMode>("table");
  const [selectedResultRowIndex, setSelectedResultRowIndex] = useState(0);
  const [recordPreviewMode, setRecordPreviewMode] = useState<PreviewMode>("fields");
  const [savedViews, setSavedViews] = useState<SavedQueryLabView[]>(() =>
    loadSavedQueryLabViews(),
  );
  const [savedViewName, setSavedViewName] = useState("");
  const [currentSavedViewId, setCurrentSavedViewId] = useState<string | null>(null);
  const queryLabEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const queryLabMonacoRef = useRef<Monaco | null>(null);
  const queryLabCompletionProviderRef = useRef<{ dispose: () => void } | null>(null);
  const queryLabAssistContextRef = useRef<QueryLabAssistContext>({
    models: [],
    modelName: "",
    operation: "findMany",
  });

  const modelQuery = useQuery({
    queryKey: ["models"],
    queryFn: ({ signal }) => fetchModelMetadata(signal),
  });
  const models = modelQuery.data ?? [];
  const selectedModelNameOrDefault = selectedModelName || models[0]?.name || "";
  const selectedModel =
    models.find((model) => model.name === selectedModelNameOrDefault) ?? null;
  const queryLabAssistContext = useMemo<QueryLabAssistContext>(
    () => ({
      models,
      modelName: selectedModel?.name ?? selectedModelNameOrDefault,
      operation,
    }),
    [models, operation, selectedModel?.name, selectedModelNameOrDefault],
  );
  const hasStaleRouteModel =
    Boolean(initialModelName) && modelQuery.isSuccess && !selectedModel;
  const hasUnavailableSelectedModel =
    Boolean(selectedModelName) && modelQuery.isSuccess && !selectedModel;

  useEffect(() => {
    persistSavedQueryLabViews(savedViews);
  }, [savedViews]);

  useEffect(() => {
    queryLabAssistContextRef.current = queryLabAssistContext;
    if (queryLabMonacoRef.current && queryLabEditorRef.current) {
      setQueryLabEditorMarkers(
        queryLabMonacoRef.current,
        queryLabEditorRef.current,
        queryLabAssistContext,
        argsSource,
      );
    }
  }, [argsSource, queryLabAssistContext]);

  useEffect(
    () => () => {
      disposeQueryLabCompletionProvider(queryLabCompletionProviderRef.current);
      queryLabCompletionProviderRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!selectedModelName && models[0]) {
      setSelectedModelName(models[0].name);
    }
  }, [models, selectedModelName]);

  useEffect(() => {
    setSelectedModelName(initialModelName ?? "");
  }, [initialModelName]);

  function selectQueryLabModel(modelName: string) {
    setSelectedModelName(modelName);
    void navigate({
      to: "/query-lab/$modelName",
      params: { modelName },
      replace: initialModelName !== null,
    });
  }

  const previewMutation = useMutation({
    mutationFn: () =>
      previewQueryLab({
        model: selectedModelNameOrDefault,
        operation,
        argsSource,
      }),
  });

  function saveQueryLabView() {
    if (!selectedModel) return;

    const result = saveSavedQueryLabView({
      currentViews: savedViews,
      currentSavedViewId,
      name: savedViewName,
      model: selectedModel.name,
      operation,
      argsSource,
      resultMode,
      recordPreviewMode,
      now: () => new Date(),
      createId: createSavedQueryLabViewId,
    });
    if (!result) return;

    setSavedViews(result.savedViews);
    setCurrentSavedViewId(result.currentSavedViewId);
    setSavedViewName(result.savedViewName);
  }

  function openSavedQueryLabView(view: SavedQueryLabView) {
    const nextState = openSavedQueryLabViewCommand(view);
    setSelectedModelName(nextState.selectedModelName);
    setOperation(nextState.operation);
    setArgsSource(nextState.argsSource);
    setResultMode(nextState.resultMode);
    setRecordPreviewMode(nextState.recordPreviewMode);
    setSelectedResultRowIndex(nextState.selectedResultRowIndex);
    setSavedViewName(nextState.savedViewName);
    setCurrentSavedViewId(nextState.currentSavedViewId);
    previewMutation.reset();
  }

  function renameSavedQueryLabView(view: SavedQueryLabView) {
    const nextName = window.prompt("Rename saved Query Lab view", view.name)?.trim();
    if (!nextName) return;

    setSavedViews((currentViews) =>
      renameSavedQueryLabViewCommand(currentViews, view.id, nextName, () => new Date()),
    );
    if (currentSavedViewId === view.id) {
      setSavedViewName(nextName);
    }
  }

  function deleteSavedQueryLabView(view: SavedQueryLabView) {
    const result = deleteSavedQueryLabViewCommand(savedViews, view.id, currentSavedViewId);
    setSavedViews(result.savedViews);
    setCurrentSavedViewId(result.currentSavedViewId);
    if (result.savedViewName !== null) setSavedViewName(result.savedViewName);
  }

  const queryLabResultViewModel = useMemo(
    () =>
      createQueryLabResultViewModel({
        preview: previewMutation.data ?? null,
        fallbackOperation: operation,
        selectedModel,
        selectedRowIndex: selectedResultRowIndex,
        isLoading: previewMutation.isPending,
        errorMessage: previewMutation.isError
          ? previewMutation.error instanceof Error
            ? previewMutation.error.message
            : "Query Lab preview failed."
          : null,
      }),
    [
      operation,
      previewMutation.data,
      previewMutation.error,
      previewMutation.isError,
      previewMutation.isPending,
      selectedModel,
      selectedResultRowIndex,
    ],
  );
  const queryInspector =
    queryLabResultViewModel.kind === "count" ||
    queryLabResultViewModel.kind === "singleMiss" ||
    queryLabResultViewModel.kind === "rows" ||
    queryLabResultViewModel.kind === "jsonOnly"
      ? queryLabResultViewModel.inspector
      : null;
  const canRun =
    Boolean(selectedModel) &&
    modelQuery.isSuccess &&
    !previewMutation.isPending;

  useEffect(() => {
    setSelectedResultRowIndex(0);
  }, [previewMutation.data]);

  function updateQueryLabResultMode(value: string) {
    if (value === "table" || value === "json") {
      setResultMode(value);
    }
  }

  function updateQueryLabPreviewMode(value: string) {
    if (value === "fields" || value === "json") {
      setRecordPreviewMode(value);
    }
  }

  function formatQueryLabArgs() {
    const result = formatQueryLabArgsSource(argsSource);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }

    setArgsSource(result.source);
  }

  const handleQueryLabEditorBeforeMount = useCallback<BeforeMount>((monaco) => {
    queryLabMonacoRef.current = monaco;
    registerQueryLabLanguage(monaco);
    if (queryLabCompletionProviderRef.current) return;

    queryLabCompletionProviderRef.current = registerQueryLabCompletionProvider(
      monaco,
      () => queryLabAssistContextRef.current,
    );
  }, []);

  const handleQueryLabEditorMount = useCallback<OnMount>(
    (editor, monaco) => {
      queryLabEditorRef.current = editor;
      queryLabMonacoRef.current = monaco;
      setQueryLabEditorMarkers(monaco, editor, queryLabAssistContextRef.current, argsSource);
    },
    [argsSource],
  );

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground shadow-tool">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface/95 px-3 backdrop-blur">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-elevated shadow-sm">
            <Database className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">Prisma Pad</h1>
            <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
              query lab
            </p>
          </div>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            to="/"
            className="rounded-md border border-border bg-elevated px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Models
          </Link>
          <Link
            to="/query-lab"
            className="rounded-md border border-primary/60 bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
          >
            Query Lab
          </Link>
        </nav>
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border bg-panel lg:border-b-0 lg:border-r">
          <div className="border-b border-border p-3">
            <div className="mb-3 flex items-center gap-2">
              <Code2 className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Query Lab</h2>
            </div>

            <label className="mb-2 block text-xs font-medium text-muted-foreground">
              Model
              <select
                value={selectedModel?.name ?? ""}
                onChange={(event) => selectQueryLabModel(event.target.value)}
                disabled={modelQuery.isLoading || models.length === 0}
                aria-label="Query Lab model"
                className="mt-1 h-9 w-full rounded-md border border-input bg-elevated px-2 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                {!selectedModel ? (
                  <option value="">
                    {hasStaleRouteModel ? "Select a valid model" : "Select model"}
                  </option>
                ) : null}
                {models.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-medium text-muted-foreground">
              Operation
              <select
                value={operation}
                onChange={(event) => {
                  if (isQueryLabOperation(event.target.value)) {
                    const nextOperation = event.target.value;
                    setOperation(nextOperation);
                    if (nextOperation === "findMany" && argsSource.trim() === "{}") {
                      setArgsSource(QUERY_LAB_DEFAULT_ARGS);
                    }
                    if (nextOperation !== "findMany" && argsSource === QUERY_LAB_DEFAULT_ARGS) {
                      setArgsSource("{}");
                    }
                  }
                }}
                aria-label="Query Lab operation"
                className="mt-1 h-9 w-full rounded-md border border-input bg-elevated px-2 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring"
              >
                {QUERY_LAB_OPERATIONS.map((queryLabOperation) => (
                  <option key={queryLabOperation} value={queryLabOperation}>
                    {queryLabOperation}
                  </option>
                ))}
              </select>
            </label>

            <section
              aria-label="Saved Query Lab views"
              className="mt-3 rounded-md border border-border bg-surface p-2"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-foreground">Saved Views</h3>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {savedViews.length}
                </span>
              </div>
              <div className="flex gap-1.5">
                <input
                  value={savedViewName}
                  onChange={(event) => setSavedViewName(event.target.value)}
                  aria-label="Saved Query Lab view name"
                  placeholder="View name"
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-elevated px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={saveQueryLabView}
                  disabled={!selectedModel || savedViewName.trim().length === 0}
                  aria-label="Save Query Lab view"
                >
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  Save
                </Button>
              </div>
              {savedViews.length > 0 ? (
                <ul className="mt-2 max-h-44 space-y-1 overflow-auto">
                  {savedViews.map((view) => {
                    const viewModelIsAvailable = models.some(
                      (model) => model.name === view.model,
                    );
                    return (
                      <li
                        key={view.id}
                        className={cn(
                          "rounded-md border border-border bg-panel px-2 py-1.5",
                          currentSavedViewId === view.id && "border-primary/60",
                        )}
                      >
                        <div className="flex items-start gap-1.5">
                          <button
                            type="button"
                            onClick={() => openSavedQueryLabView(view)}
                            aria-label={`Open saved Query Lab view ${view.name}`}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate text-xs font-medium text-foreground">
                              {view.name}
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                              {view.model}.{view.operation}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => renameSavedQueryLabView(view)}
                            aria-label={`Rename saved Query Lab view ${view.name}`}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-elevated hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSavedQueryLabView(view)}
                            aria-label={`Delete saved Query Lab view ${view.name}`}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        {!viewModelIsAvailable && modelQuery.isSuccess ? (
                          <p className="mt-1 text-[10px] text-warning">
                            Saved model is not in current metadata.
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Save local Query Lab views for this browser.
                </p>
              )}
            </section>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3 text-xs text-muted-foreground">
            {modelQuery.isLoading ? (
              <div className="rounded-md border border-dashed border-border bg-surface p-3">
                Loading models...
              </div>
            ) : modelQuery.isError ? (
              <div className="rounded-md border border-dashed border-danger/70 bg-surface p-3">
                <p className="font-medium text-danger">Could not load models.</p>
                <p className="mt-1">
                  {modelQuery.error instanceof Error
                    ? modelQuery.error.message
                    : "Could not load Prisma model metadata."}
                </p>
              </div>
            ) : hasStaleRouteModel || hasUnavailableSelectedModel ? (
              <div className="rounded-md border border-dashed border-border bg-surface p-3">
                <p className="font-medium text-foreground">Model not found.</p>
                <p className="mt-1">
                  Model "{initialModelName ?? selectedModelName}" is no longer available. Select a
                  valid model to continue.
                </p>
                {models.length > 0 ? (
                  <div
                    className="mt-3 flex flex-wrap gap-1.5"
                    aria-label="Available Query Lab models"
                  >
                    {models.map((model) => (
                      <Button
                        key={model.name}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => selectQueryLabModel(model.name)}
                      >
                        {model.name}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : selectedModel ? (
              <div className="rounded-md border border-border bg-surface">
                <div className="border-b border-border px-2 py-2 font-medium text-foreground">
                  {selectedModel.name}
                </div>
                <dl>
                  {selectedModel.fields.slice(0, 10).map((field) => (
                    <div
                      key={field.name}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border px-2 py-1.5 last:border-b-0"
                    >
                      <dt className="truncate text-foreground">{field.name}</dt>
                      <dd className="font-mono text-[11px]">{formatFieldType(field)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-surface p-3">
                No Prisma models found.
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col bg-surface">
          <div className="flex min-h-0 flex-1 flex-col border-b border-border">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-panel/80 px-3">
              <span className="font-mono text-[11px] uppercase text-muted-foreground">
                Args Mode
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={formatQueryLabArgs}
                  aria-label="Format Query Lab args"
                >
                  <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Format
                </Button>
                <Button
                  type="button"
                  onClick={() => previewMutation.mutate()}
                  disabled={!canRun}
                  aria-label="Run Query Lab preview"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  Run
                </Button>
              </div>
            </div>
            <div className="min-h-[220px] flex-1">
              <Editor
                height="100%"
                defaultLanguage={QUERY_LAB_LANGUAGE_ID}
                theme={QUERY_LAB_THEME_ID}
                value={argsSource}
                onChange={(value) => setArgsSource(value ?? "")}
                beforeMount={handleQueryLabEditorBeforeMount}
                onMount={handleQueryLabEditorMount}
                options={{
                  minimap: { enabled: false },
                  fontFamily:
                    '"Berkeley Mono", "JetBrains Mono", "SFMono-Regular", Consolas, monospace',
                  fontSize: 12,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  wordWrap: "on",
                }}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-h-[220px]">
              {queryLabResultViewModel.kind === "loading" ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Running preview...
                </div>
              ) : queryLabResultViewModel.kind === "error" ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  <p className="font-medium text-danger">Could not run preview.</p>
                  <p className="mt-1">{queryLabResultViewModel.message}</p>
                </div>
              ) : queryLabResultViewModel.kind === "empty" ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Preview results will appear here.
                </div>
              ) : queryLabResultViewModel.kind === "count" ? (
                <div className="p-6">
                  <div className="mb-3">
                    <Tabs value="json" onValueChange={updateQueryLabResultMode}>
                      <TabsList>
                        <TabsTrigger
                          value="json"
                          currentValue="json"
                          onValueChange={updateQueryLabResultMode}
                        >
                          <span className="inline-flex items-center gap-1">
                            <FileJson className="h-3 w-3" />
                            JSON
                          </span>
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  <div className="inline-flex min-w-36 flex-col rounded-md border border-border bg-panel px-4 py-3">
                    <span className="text-xs font-medium text-muted-foreground">Count</span>
                    <span className="mt-1 font-mono text-3xl font-semibold text-foreground">
                      {queryLabResultViewModel.value}
                    </span>
                  </div>
                  <pre
                    aria-label="Query Lab JSON result"
                    className="mt-3 max-h-72 overflow-auto rounded-md border border-border bg-panel p-3 font-mono text-[11px] text-code"
                  >
                    {queryLabResultViewModel.json}
                  </pre>
                </div>
              ) : queryLabResultViewModel.kind === "singleMiss" ? (
                <div className="p-6">
                  <Tabs value="json" onValueChange={updateQueryLabResultMode}>
                    <TabsList className="mb-3">
                      <TabsTrigger
                        value="json"
                        currentValue="json"
                        onValueChange={updateQueryLabResultMode}
                      >
                        <span className="inline-flex items-center gap-1">
                          <FileJson className="h-3 w-3" />
                          JSON
                        </span>
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <div className="text-center text-xs text-muted-foreground">
                    No record matched this {queryLabResultViewModel.operation} query.
                  </div>
                  <pre
                    aria-label="Query Lab JSON result"
                    className="mt-3 max-h-72 overflow-auto rounded-md border border-border bg-panel p-3 font-mono text-[11px] text-code"
                  >
                    {queryLabResultViewModel.json}
                  </pre>
                </div>
              ) : queryLabResultViewModel.kind === "rows" ? (
                <div>
                  <div className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-2">
                    <Tabs value={resultMode} onValueChange={updateQueryLabResultMode}>
                      <TabsList>
                        <TabsTrigger
                          value="table"
                          currentValue={resultMode}
                          onValueChange={updateQueryLabResultMode}
                        >
                          <span className="inline-flex items-center gap-1">
                            <TableProperties className="h-3 w-3" />
                            Table
                          </span>
                        </TabsTrigger>
                        <TabsTrigger
                          value="json"
                          currentValue={resultMode}
                          onValueChange={updateQueryLabResultMode}
                        >
                          <span className="inline-flex items-center gap-1">
                            <FileJson className="h-3 w-3" />
                            JSON
                          </span>
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  {resultMode === "table" ? (
                    <table
                      aria-label="Query Lab table result"
                      className="w-max min-w-full border-collapse text-left text-xs"
                    >
                      <thead className="sticky top-10 bg-panel">
                        <tr>
                          {queryLabResultViewModel.columns.map((column) => (
                            <th
                              key={column}
                              className="min-w-[150px] border-b border-r border-border px-3 py-2 font-medium text-muted-foreground last:border-r-0"
                            >
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {queryLabResultViewModel.rows.map((row, index) => (
                          <tr
                            key={index}
                            aria-label={`Select Query Lab result row ${index + 1}`}
                            aria-selected={
                              queryLabResultViewModel.selectedRowIndex === index
                                ? "true"
                                : undefined
                            }
                            tabIndex={0}
                            onClick={() => setSelectedResultRowIndex(index)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedResultRowIndex(index);
                              }
                            }}
                            className={cn(
                              "h-10 cursor-pointer border-b border-border outline-none hover:bg-elevated/70 focus:bg-elevated/70",
                              queryLabResultViewModel.selectedRowIndex === index && "bg-elevated",
                            )}
                          >
                            {queryLabResultViewModel.columns.map((column) => (
                              <td
                                key={column}
                                className="min-w-[150px] border-r border-border px-3 py-1.5 last:border-r-0"
                              >
                                <span
                                  title={formatValue(row[column])}
                                  className="block max-h-5 truncate font-mono text-[11px] leading-5"
                                >
                                  {formatValue(row[column])}
                                </span>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <pre
                      aria-label="Query Lab JSON result"
                      className="m-3 overflow-auto rounded-md border border-border bg-panel p-3 font-mono text-[11px] text-code"
                    >
                      {queryLabResultViewModel.resultJson}
                    </pre>
                  )}
                </div>
              ) : queryLabResultViewModel.kind === "jsonOnly" ? (
                <pre
                  aria-label="Query Lab JSON result"
                  className="m-3 overflow-auto rounded-md border border-border bg-panel p-3 font-mono text-[11px] text-code"
                >
                  {queryLabResultViewModel.json}
                </pre>
              ) : null}
            </div>

            {queryLabResultViewModel.kind === "rows" ? (
              <section
                aria-label="Query Lab record preview"
                className="border-t border-border bg-panel px-3 py-3"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Record Preview</h2>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      Row {queryLabResultViewModel.selectedRowIndex + 1} of{" "}
                      {queryLabResultViewModel.rows.length}
                    </p>
                  </div>
                </div>
                <RecordPreview
                  record={queryLabResultViewModel.selectedRow}
                  fields={queryLabResultViewModel.selectedFields}
                  previewMode={recordPreviewMode}
                  onPreviewModeChange={updateQueryLabPreviewMode}
                  emptyMessage="Select a Query Lab result row to inspect the full record."
                />
              </section>
            ) : null}

            {queryInspector ? (
              <section
                aria-label="Query Inspector"
                className="border-t border-border bg-panel px-3 py-3"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Query Inspector</h2>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {queryInspector.title}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard?.writeText(queryInspector.prismaCall);
                    }}
                    aria-label="Copy Prisma Client call"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Copy
                  </Button>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="min-w-0">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      Normalized Args
                    </div>
                    <pre
                      aria-label="Normalized Query Lab args"
                      className="max-h-72 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-[11px] text-code"
                    >
                      {queryInspector.normalizedArgsJson}
                    </pre>
                    {queryInspector.normalizationMessages.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {queryInspector.normalizationMessages.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        All displayed args came from the editor input.
                      </p>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      Prisma Client Call
                    </div>
                    <pre
                      aria-label="Prisma Client call"
                      className="max-h-72 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-[11px] text-code"
                    >
                      {queryInspector.prismaCall}
                    </pre>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="min-w-0">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      Duration
                    </div>
                    <div
                      aria-label="Query Lab duration"
                      className="rounded-md border border-border bg-surface p-3 font-mono text-[11px] text-code"
                    >
                      {queryInspector.durationLabel}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      Safety Limits
                    </div>
                    <dl
                      aria-label="Query Lab safety limits"
                      className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-border bg-surface p-3 font-mono text-[11px] text-code"
                    >
                      {queryInspector.safetyLimits.map((limit) => (
                        <Fragment key={limit.label}>
                          <dt className="text-muted-foreground">{limit.label}</dt>
                          <dd>{limit.value}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  </div>

                  <div className="min-w-0">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      Warnings
                    </div>
                    {queryInspector.warnings.length > 0 ? (
                      <ul
                        aria-label="Query Lab warnings"
                        className="space-y-2 rounded-md border border-warning/40 bg-surface p-3 text-xs"
                      >
                        {queryInspector.warnings.map((warning, index) => (
                          <li
                            key={`${warning.code ?? "warning"}-${warning.path ?? index}`}
                            className="flex gap-2"
                          >
                            <TriangleAlert
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              {warning.path ? (
                                <div className="font-mono text-[11px] text-muted-foreground">
                                  {warning.path}
                                </div>
                              ) : null}
                              <div className="text-foreground">{warning.message}</div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div
                        aria-label="Query Lab warnings"
                        className="rounded-md border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground"
                      >
                        No deterministic performance warnings for this run.
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      SQL Events
                    </div>
                    {queryInspector.sqlEvents.length > 0 ? (
                      <div aria-label="Query Lab SQL events" className="space-y-2">
                        {queryInspector.sqlEvents.map((event, index) => (
                          <div
                            key={index}
                            className="rounded-md border border-border bg-surface p-3"
                          >
                            <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                              <span className="font-mono">{event.label}</span>
                              {event.durationLabel ? (
                                <span className="font-mono">{event.durationLabel}</span>
                              ) : null}
                            </div>
                            {event.query ? (
                              <pre
                                aria-label={`Query Lab SQL ${index + 1}`}
                                className="max-h-48 overflow-auto rounded-md border border-border bg-panel p-2 font-mono text-[11px] text-code"
                              >
                                {event.query}
                              </pre>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                SQL text was not provided for this event.
                              </p>
                            )}
                            {event.params ? (
                              <pre
                                aria-label={`Query Lab SQL params ${index + 1}`}
                                className="mt-2 max-h-32 overflow-auto rounded-md border border-border bg-panel p-2 font-mono text-[11px] text-code"
                              >
                                {event.params}
                              </pre>
                            ) : (
                              <p className="mt-2 text-xs text-muted-foreground">
                                SQL params were not provided for this event.
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        aria-label="Query Lab SQL events"
                        className="rounded-md border border-dashed border-border bg-surface p-3 text-xs text-muted-foreground"
                      >
                        No SQL event data was captured for this run.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
