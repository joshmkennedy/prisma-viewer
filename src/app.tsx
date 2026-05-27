import {
  ChevronDown,
  Columns3,
  Database,
  FileJson,
  RefreshCcw,
  Search,
  TableProperties,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { cn } from "./lib/utils";

type Field = {
  name: string;
  type: string;
};

type Model = {
  name: string;
  rowCount: number;
  fields: Field[];
  rows: Record<string, unknown>[];
};

const models: Model[] = [
  {
    name: "User",
    rowCount: 428,
    fields: [
      { name: "id", type: "String" },
      { name: "email", type: "String" },
      { name: "name", type: "String?" },
      { name: "role", type: "String" },
      { name: "createdAt", type: "DateTime" },
      { name: "metadata", type: "Json" },
    ],
    rows: [
      {
        id: "usr_01HV8ZB7AQ9F",
        email: "nora.chen@example.dev",
        name: "Nora Chen",
        role: "admin",
        createdAt: "2026-05-19T14:22:31.000Z",
        metadata: { plan: "team", flags: ["beta_tables", "json_preview"] },
      },
      {
        id: "usr_01HV8ZBSJTXR",
        email: "miles.gray@example.dev",
        name: null,
        role: "developer",
        createdAt: "2026-05-20T09:10:08.000Z",
        metadata: { plan: "free", source: "seed" },
      },
      {
        id: "usr_01HV91MG2V01",
        email: "leah.patel@example.dev",
        name: "Leah Patel",
        role: "viewer",
        createdAt: "2026-05-21T18:45:12.000Z",
        metadata: { plan: "pro", lastWorkspace: "workspace_42" },
      },
    ],
  },
  {
    name: "Project",
    rowCount: 64,
    fields: [
      { name: "id", type: "String" },
      { name: "slug", type: "String" },
      { name: "name", type: "String" },
      { name: "status", type: "String" },
      { name: "updatedAt", type: "DateTime" },
    ],
    rows: [
      {
        id: "prj_7cc5",
        slug: "billing-ledger",
        name: "Billing Ledger",
        status: "active",
        updatedAt: "2026-05-26T22:14:50.000Z",
      },
      {
        id: "prj_8af1",
        slug: "internal-tools",
        name: "Internal Tools",
        status: "paused",
        updatedAt: "2026-05-24T11:33:21.000Z",
      },
    ],
  },
  {
    name: "AuditLog",
    rowCount: 12043,
    fields: [
      { name: "id", type: "BigInt" },
      { name: "actorId", type: "String" },
      { name: "action", type: "String" },
      { name: "resource", type: "String" },
      { name: "payload", type: "Json" },
      { name: "createdAt", type: "DateTime" },
    ],
    rows: [
      {
        id: 983421,
        actorId: "usr_01HV8ZB7AQ9F",
        action: "workspace.member.invited",
        resource: "workspace_42",
        payload: {
          email: "sam.rivera@example.dev",
          role: "viewer",
          inviteId: "inv_91ab",
        },
        createdAt: "2026-05-26T13:04:19.000Z",
      },
    ],
  },
  {
    name: "Session",
    rowCount: 816,
    fields: [
      { name: "id", type: "String" },
      { name: "userId", type: "String" },
      { name: "expiresAt", type: "DateTime" },
      { name: "ipAddress", type: "String?" },
    ],
    rows: [],
  },
];

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

export function App() {
  const [search, setSearch] = useState("");
  const [selectedModelName, setSelectedModelName] = useState(models[0].name);
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [previewMode, setPreviewMode] = useState("fields");

  const filteredModels = useMemo(
    () =>
      models.filter((model) =>
        model.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [search],
  );

  const selectedModel =
    models.find((model) => model.name === selectedModelName) ?? models[0];
  const selectedRow = selectedModel.rows[selectedRowIndex] ?? null;

  function selectModel(modelName: string) {
    setSelectedModelName(modelName);
    setSelectedRowIndex(0);
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
            {filteredModels.map((model) => (
              <button
                key={model.name}
                type="button"
                onClick={() => selectModel(model.name)}
                className={cn(
                  "mb-1 grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-background",
                  selectedModel.name === model.name &&
                    "bg-background text-primary shadow-sm ring-1 ring-border",
                )}
              >
                <span className="min-w-0 truncate font-medium">{model.name}</span>
                <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {model.rowCount}
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 overflow-hidden border-b border-border bg-background lg:border-b-0 lg:border-r">
          <div className="flex h-11 items-center justify-between border-b border-border px-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{selectedModel.name}</h2>
              <p className="text-xs text-muted-foreground">
                {selectedModel.rows.length} loaded of {selectedModel.rowCount}
              </p>
            </div>
            <Button variant="ghost" size="icon" type="button" aria-label="Columns">
              <Columns3 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="h-[45vh] overflow-auto lg:h-[calc(100vh-5.75rem)]">
            <table className="min-w-[720px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  {selectedModel.fields.map((field) => (
                    <th
                      key={field.name}
                      className="border-b border-r border-border px-3 py-2 font-medium text-muted-foreground last:border-r-0"
                    >
                      <span className="block truncate">{field.name}</span>
                      <span className="block truncate font-mono text-[10px] font-normal">
                        {field.type}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedModel.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={selectedModel.fields.length}
                      className="h-28 px-3 text-center text-xs text-muted-foreground"
                    >
                      No rows returned for this model.
                    </td>
                  </tr>
                ) : (
                  selectedModel.rows.map((row, rowIndex) => (
                    <tr
                      key={String(row.id ?? rowIndex)}
                      onClick={() => setSelectedRowIndex(rowIndex)}
                      className={cn(
                        "h-10 cursor-pointer border-b border-border hover:bg-accent/50",
                        rowIndex === selectedRowIndex && "bg-accent/70",
                      )}
                    >
                      {selectedModel.fields.map((field) => {
                        const value = row[field.name];
                        return (
                          <td
                            key={field.name}
                            className={cn(
                              "max-w-48 border-r border-border px-3 py-2 last:border-r-0",
                              value === null && "font-mono text-muted-foreground",
                            )}
                          >
                            <span className="block truncate">
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
                    {selectedModel.fields.map((field) => (
                      <div
                        key={field.name}
                        className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-border last:border-b-0"
                      >
                        <dt className="border-r border-border bg-muted px-2 py-2">
                          <span className="block truncate text-xs font-medium">
                            {field.name}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">
                            {field.type}
                          </span>
                        </dt>
                        <dd className="min-w-0 px-2 py-2 font-mono text-[11px] leading-5">
                          <span
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
