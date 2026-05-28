import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import {
  keepPreviousData,
  useMutation,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import Editor, { type BeforeMount, type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor, languages as MonacoLanguages } from "monaco-editor";
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
  Code2,
  Copy,
  Database,
  FileJson,
  Filter,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  Search,
  TableProperties,
  Save,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { fetchModelMetadata, fetchModelRows } from "./api/prisma-viewer-client";
import { previewQueryLab } from "./api/query-lab-client";
import type { Field, Model } from "./domain/prisma-metadata";
import { formatFieldType, formatValue, getCellTone } from "./domain/row-formatting";
import { RecordPreview } from "./features/record-preview/RecordPreview";
import type { PreviewMode } from "./features/record-preview/record-preview-model";
import { cn } from "./lib/utils";
import {
  DEFAULT_TABLE_PAGE_SIZE,
  ROW_REFINEMENT_DEBOUNCE_MS,
  ROWS_QUERY_KEY,
  TABLE_PAGE_SIZE_OPTIONS,
  createModelTableBrowser,
  enumValuesForField,
  operatorsForField,
  type ModelRowsRequest,
  type TableFilter,
  type TableRefinements,
  type TableRow,
} from "./model-table-browser";
import {
  filterOperators,
  normalizeModelRouteSearch,
  validateModelRouteSearch,
  type FilterOperator,
  type ModelRouteSearchInput,
} from "./features/model-browser/model-route-search";
import { formatQueryLabArgsSource } from "./query-lab-args-format";
import {
  getQueryLabCompletions,
  getQueryLabEditorDiagnostics,
  type QueryLabAssistContext,
  type QueryLabCompletionKind,
} from "./query-lab-editor-assist";
import {
  QUERY_LAB_OPERATIONS,
  createQueryLabResultViewModel,
  type QueryLabOperation,
  type QueryLabResultMode,
} from "./query-lab-result-presenter";

type ModelLoadState =
  | { status: "loading"; models: Model[]; error: null }
  | { status: "success"; models: Model[]; error: null }
  | { status: "error"; models: Model[]; error: string };

type RowLoadState =
  | { status: "idle"; rows: Record<string, unknown>[]; error: null }
  | { status: "loading"; rows: Record<string, unknown>[]; error: null }
  | { status: "success"; rows: Record<string, unknown>[]; error: null }
  | { status: "error"; rows: Record<string, unknown>[]; error: string };

type SavedQueryLabView = {
  id: string;
  name: string;
  model: string;
  operation: QueryLabOperation;
  argsSource: string;
  resultMode: QueryLabResultMode;
  recordPreviewMode: PreviewMode;
  updatedAt: string;
};

const QUERY_LAB_DEFAULT_ARGS = "{}";
const QUERY_LAB_SAVED_VIEWS_STORAGE_KEY = "prisma-viewer.query-lab.saved-views.v1";
const QUERY_LAB_LANGUAGE_ID = "query-lab-args";
const QUERY_LAB_THEME_ID = "query-lab-theme";
const QUERY_LAB_MARKER_OWNER = "query-lab-assist";

const THEME_COLORS = {
  background: "#0c0e13",
  foreground: "#e1e7ef",
  surface: "#101319",
  panel: "#14181f",
  elevated: "#1b1f27",
  muted: "#242932",
  mutedForeground: "#959fac",
  border: "#2f3542",
  input: "#323a48",
  primary: "#12d9b8",
  accent: "#3191f6",
  code: "#fad242",
  warning: "#fa8d2e",
  danger: "#ea5358",
} as const;

function monacoCompletionKind(monaco: Monaco, kind: QueryLabCompletionKind) {
  if (kind === "arg") return monaco.languages.CompletionItemKind.Property;
  if (kind === "relation") return monaco.languages.CompletionItemKind.Reference;
  if (kind === "enum") return monaco.languages.CompletionItemKind.EnumMember;
  if (kind === "operator") return monaco.languages.CompletionItemKind.Operator;
  if (kind === "literal") return monaco.languages.CompletionItemKind.Value;
  return monaco.languages.CompletionItemKind.Field;
}

function setQueryLabEditorMarkers(
  monaco: Monaco,
  editor: MonacoEditor.IStandaloneCodeEditor,
  context: QueryLabAssistContext,
  source: string,
) {
  const model = editor.getModel();
  if (!model) return;
  const markers = getQueryLabEditorDiagnostics(source, context).map((diagnostic) => {
    const start = model.getPositionAt(diagnostic.startOffset);
    const end = model.getPositionAt(Math.max(diagnostic.endOffset, diagnostic.startOffset + 1));
    return {
      severity: monaco.MarkerSeverity.Warning,
      message: diagnostic.message,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    };
  });
  monaco.editor.setModelMarkers(model, QUERY_LAB_MARKER_OWNER, markers);
}

function registerQueryLabLanguage(monaco: Monaco) {
  if (
    !monaco.languages
      .getLanguages()
      .some((language: MonacoLanguages.ILanguageExtensionPoint) =>
        language.id === QUERY_LAB_LANGUAGE_ID
      )
  ) {
    monaco.languages.register({ id: QUERY_LAB_LANGUAGE_ID });
    monaco.languages.setMonarchTokensProvider(QUERY_LAB_LANGUAGE_ID, {
      tokenizer: {
        root: [
          [/[{}[\]:,]/, "delimiter"],
          [/"([^"\\]|\\.)*$/, "string.invalid"],
          [/"/, { token: "string.quote", next: "@string" }],
          [/'([^'\\]|\\.)*$/, "string.invalid"],
          [/'/, { token: "string.quote", next: "@singleString" }],
          [/\b(true|false|null)\b/, "constant"],
          [/\b\d+(\.\d+)?\b/, "number"],
          [/[A-Za-z_$][\w$]*/, "identifier"],
        ],
        string: [
          [/[^\\"]+/, "string"],
          [/\\./, "string.escape"],
          [/"/, { token: "string.quote", next: "@pop" }],
        ],
        singleString: [
          [/[^\\']+/, "string"],
          [/\\./, "string.escape"],
          [/'/, { token: "string.quote", next: "@pop" }],
        ],
      },
    });
  }

  monaco.editor.defineTheme(QUERY_LAB_THEME_ID, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "delimiter", foreground: THEME_COLORS.mutedForeground.slice(1) },
      { token: "identifier", foreground: THEME_COLORS.foreground.slice(1) },
      { token: "constant", foreground: THEME_COLORS.accent.slice(1) },
      { token: "number", foreground: THEME_COLORS.primary.slice(1) },
      { token: "string", foreground: THEME_COLORS.code.slice(1) },
      { token: "string.quote", foreground: THEME_COLORS.code.slice(1) },
      { token: "string.escape", foreground: THEME_COLORS.accent.slice(1) },
      { token: "string.invalid", foreground: THEME_COLORS.danger.slice(1) },
    ],
    colors: {
      "editor.background": THEME_COLORS.surface,
      "editor.foreground": THEME_COLORS.foreground,
      "editorLineNumber.foreground": THEME_COLORS.mutedForeground,
      "editorLineNumber.activeForeground": THEME_COLORS.primary,
      "editorCursor.foreground": THEME_COLORS.primary,
      "editor.selectionBackground": `${THEME_COLORS.accent}55`,
      "editor.inactiveSelectionBackground": `${THEME_COLORS.accent}33`,
      "editor.lineHighlightBackground": THEME_COLORS.panel,
      "editorLineNumber.dimmedForeground": THEME_COLORS.muted,
      "editorIndentGuide.background1": THEME_COLORS.border,
      "editorIndentGuide.activeBackground1": THEME_COLORS.mutedForeground,
      "editorWidget.background": THEME_COLORS.elevated,
      "editorWidget.border": THEME_COLORS.border,
      "editorSuggestWidget.background": THEME_COLORS.elevated,
      "editorSuggestWidget.border": THEME_COLORS.border,
      "editorSuggestWidget.foreground": THEME_COLORS.foreground,
      "editorSuggestWidget.highlightForeground": THEME_COLORS.primary,
      "editorSuggestWidget.selectedBackground": THEME_COLORS.muted,
      "editorHoverWidget.background": THEME_COLORS.elevated,
      "editorHoverWidget.border": THEME_COLORS.border,
      "editorMarkerNavigation.background": THEME_COLORS.panel,
      "editorWarning.foreground": THEME_COLORS.warning,
      "editorError.foreground": THEME_COLORS.danger,
      "editorGutter.background": THEME_COLORS.panel,
    },
  });
}

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

function isQueryLabOperation(value: unknown): value is QueryLabOperation {
  return (
    typeof value === "string" &&
    QUERY_LAB_OPERATIONS.includes(value as QueryLabOperation)
  );
}

function isQueryLabResultMode(value: unknown): value is QueryLabResultMode {
  return value === "table" || value === "json";
}

function isPreviewMode(value: unknown): value is PreviewMode {
  return value === "fields" || value === "json";
}

function loadSavedQueryLabViews(): SavedQueryLabView[] {
  if (typeof window === "undefined") return [];

  try {
    const rawValue = window.localStorage.getItem(QUERY_LAB_SAVED_VIEWS_STORAGE_KEY);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const candidate = item as Partial<SavedQueryLabView>;
        if (
          typeof candidate.id !== "string" ||
          typeof candidate.name !== "string" ||
          typeof candidate.model !== "string" ||
          !isQueryLabOperation(candidate.operation) ||
          typeof candidate.argsSource !== "string"
        ) {
          return null;
        }

        return {
          id: candidate.id,
          name: candidate.name.trim() || "Untitled view",
          model: candidate.model,
          operation: candidate.operation,
          argsSource: candidate.argsSource,
          resultMode: isQueryLabResultMode(candidate.resultMode)
            ? candidate.resultMode
            : "table",
          recordPreviewMode: isPreviewMode(candidate.recordPreviewMode)
            ? candidate.recordPreviewMode
            : "fields",
          updatedAt:
            typeof candidate.updatedAt === "string"
              ? candidate.updatedAt
              : new Date(0).toISOString(),
        };
      })
      .filter((item): item is SavedQueryLabView => item !== null);
  } catch {
    return [];
  }
}

function persistSavedQueryLabViews(savedViews: SavedQueryLabView[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    QUERY_LAB_SAVED_VIEWS_STORAGE_KEY,
    JSON.stringify(savedViews),
  );
}

function createSavedQueryLabViewId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `view-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  validateSearch: validateModelRouteSearch,
  component: ModelRoute,
});

const queryLabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/query-lab",
  component: () => <QueryLabRoute initialModelName={null} />,
});

const queryLabModelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/query-lab/$modelName",
  component: QueryLabModelRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  modelRoute,
  queryLabRoute,
  queryLabModelRoute,
]);
const typedRouter = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof typedRouter;
  }
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createRouter({ routeTree }));

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function ModelRoute() {
  const { modelName } = modelRoute.useParams();
  const routeSearch = modelRoute.useSearch();
  return <AppContent routedModelName={modelName} rawRouteSearch={routeSearch} />;
}

function QueryLabModelRoute() {
  const { modelName } = queryLabModelRoute.useParams();
  return <QueryLabRoute initialModelName={modelName} />;
}

function QueryLabRoute({ initialModelName }: { initialModelName: string | null }) {
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
      queryLabCompletionProviderRef.current?.dispose();
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
    const name = savedViewName.trim();
    if (!name || !selectedModel) return;

    const now = new Date().toISOString();
    const id = currentSavedViewId ?? createSavedQueryLabViewId();
    const view: SavedQueryLabView = {
      id,
      name,
      model: selectedModel.name,
      operation,
      argsSource,
      resultMode,
      recordPreviewMode,
      updatedAt: now,
    };

    setSavedViews((currentViews) => {
      const existingIndex = currentViews.findIndex((item) => item.id === id);
      if (existingIndex === -1) return [view, ...currentViews];
      return currentViews.map((item) => (item.id === id ? view : item));
    });
    setCurrentSavedViewId(id);
  }

  function openSavedQueryLabView(view: SavedQueryLabView) {
    setSelectedModelName(view.model);
    setOperation(view.operation);
    setArgsSource(view.argsSource);
    setResultMode(view.resultMode);
    setRecordPreviewMode(view.recordPreviewMode);
    setSelectedResultRowIndex(0);
    setSavedViewName(view.name);
    setCurrentSavedViewId(view.id);
    previewMutation.reset();
  }

  function renameSavedQueryLabView(view: SavedQueryLabView) {
    const nextName = window.prompt("Rename saved Query Lab view", view.name)?.trim();
    if (!nextName) return;

    setSavedViews((currentViews) =>
      currentViews.map((item) =>
        item.id === view.id
          ? { ...item, name: nextName, updatedAt: new Date().toISOString() }
          : item,
      ),
    );
    if (currentSavedViewId === view.id) {
      setSavedViewName(nextName);
    }
  }

  function deleteSavedQueryLabView(view: SavedQueryLabView) {
    setSavedViews((currentViews) => currentViews.filter((item) => item.id !== view.id));
    if (currentSavedViewId === view.id) {
      setCurrentSavedViewId(null);
      setSavedViewName("");
    }
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

    queryLabCompletionProviderRef.current =
      monaco.languages.registerCompletionItemProvider(QUERY_LAB_LANGUAGE_ID, {
        triggerCharacters: [":", "{", ",", "\"", "'"],
        provideCompletionItems: (
          model: MonacoEditor.ITextModel,
          position: { lineNumber: number; column: number },
        ) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          const suggestions = getQueryLabCompletions(
            model.getValue(),
            model.getOffsetAt(position),
            queryLabAssistContextRef.current,
          ).map((item) => ({
            label: item.label,
            insertText: item.insertText,
            kind: monacoCompletionKind(monaco, item.kind),
            detail: item.detail,
            range,
          }));

          return { suggestions };
        },
      });
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
            <h1 className="truncate text-sm font-semibold">Prisma Viewer</h1>
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

function AppContent({
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
    navigateModelSearch(tableBrowser.commands.selectRow(rowIndex));
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
          <Link
            to="/query-lab"
            className="rounded-md border border-border bg-elevated px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Query Lab
          </Link>
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
                    ? tableBrowser.summary
                    : "Load metadata to inspect model fields"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedModel ? (
                  <Link
                    to="/query-lab/$modelName"
                    params={{ modelName: selectedModel.name }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-elevated px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                    aria-label={`Open Query Lab for ${selectedModel.name}`}
                  >
                    <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Query Lab
                  </Link>
                ) : null}
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
            </div>

            {isModelRoute ? (
              <div className="flex flex-col gap-2">
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
            <RecordPreview
              record={selectedRow}
              fields={tableFields}
              previewMode={previewMode}
              onPreviewModeChange={updatePreviewMode}
              emptyMessage="Select a table row to inspect the full record."
            />
          </div>
        </aside>
      </section>
    </main>
  );
}
