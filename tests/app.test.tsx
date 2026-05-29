// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app";

const monacoSetModelMarkers = vi.hoisted(() => vi.fn());
const monacoDefineTheme = vi.hoisted(() => vi.fn());
const monacoRegisterLanguage = vi.hoisted(() => vi.fn());
const monacoSetMonarchTokensProvider = vi.hoisted(() => vi.fn());
const monacoRegisterCompletionItemProvider = vi.hoisted(() =>
  vi.fn(() => ({ dispose: vi.fn() })),
);

vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return {
    ...actual,
    toast: {
      ...actual.toast,
      error: vi.fn(),
      success: vi.fn(),
    },
  };
});

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
    beforeMount,
    onMount,
  }: {
    value: string;
    onChange: (value: string | undefined) => void;
    beforeMount?: (monaco: unknown) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    const model = {
      getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
      getValue: () => value,
      getOffsetAt: () => 0,
      getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
    };
    const monaco = {
      MarkerSeverity: { Warning: 4 },
      editor: { defineTheme: monacoDefineTheme, setModelMarkers: monacoSetModelMarkers },
      languages: {
        CompletionItemKind: {
          Property: 9,
          Reference: 18,
          EnumMember: 20,
          Operator: 11,
          Value: 12,
          Field: 5,
        },
        getLanguages: vi.fn(() => []),
        register: monacoRegisterLanguage,
        setMonarchTokensProvider: monacoSetMonarchTokensProvider,
        registerCompletionItemProvider: monacoRegisterCompletionItemProvider,
      },
    };
    beforeMount?.(monaco);
    onMount?.({ getModel: () => model }, monaco);

    return (
      <div
        aria-label="Args Mode editor"
        role="textbox"
        contentEditable
        suppressContentEditableWarning
        onInput={(event) => onChange(event.currentTarget.textContent ?? "")}
      >
        {value}
      </div>
    );
  },
}));

type QueryLabSqlEvent = {
  query?: string;
  params?: string;
  durationMs?: number;
};

type QueryLabWarning = {
  code?: string;
  path?: string;
  message: string;
};

describe("App model sidebar", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches models from the metadata API and renders them as a selectable list", async () => {
    mockApiResponses({
      models: [
        model("User", ["id", "email"]),
        model("AuditLog", ["id", "action", "payload"]),
      ],
      rowsByModel: {
        User: [{ id: "user_1", email: "ada@example.com" }],
        AuditLog: [],
      },
    });

    renderApp();

    expect(await screen.findByRole("button", { name: "User model, 2 columns" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AuditLog model, 3 columns" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "User model, 2 columns" }).getAttribute("aria-current"),
    ).toBe("true");
    expect(await screen.findByText("1 row loaded, 2 columns shown")).toBeTruthy();
    expect(screen.getByText("email")).toBeTruthy();
  });

  it("renders the index route as a table of all models", async () => {
    mockApiResponses({
      models: [
        model("User", ["id", "email"]),
        model("AuditLog", ["id", "action", "payload"]),
      ],
      rowsByModel: {
        User: [],
        AuditLog: [],
      },
    });

    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Models" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "User" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "AuditLog" })).toBeTruthy();
    expect(screen.queryByText("No rows found for this model.")).toBeNull();
  });

  it("updates the selected model when a model is clicked", async () => {
    mockApiResponses({
      models: [
        model("User", ["id", "email"]),
        model("Project", ["id", "slug", "name"]),
      ],
      rowsByModel: {
        User: [],
        Project: [{ id: "project_1", slug: "alpha", name: "Alpha" }],
      },
    });

    renderApp();

    const projectButton = await screen.findByRole("button", {
      name: "Project model, 3 columns",
    });
    await userEvent.click(projectButton);

    expect(projectButton.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("heading", { name: "Project" })).toBeTruthy();
    expect(await screen.findByText("1 row loaded, 3 columns shown")).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
  });

  it("renders loading, empty, and error states clearly", async () => {
    mockPendingModelsResponse();
    const { unmount } = renderApp();
    expect((await screen.findAllByText("Loading models...")).length).toBeGreaterThan(0);
    unmount();

    mockApiResponses({ models: [], rowsByModel: {} });
    renderApp();
    expect((await screen.findAllByText("No Prisma models found.")).length).toBeGreaterThan(0);
    cleanup();

    mockRejectedModelsResponse(new Error("metadata unavailable"));
    renderApp();
    expect((await screen.findAllByText("Could not load models.")).length).toBeGreaterThan(0);
    expect(screen.getByText("metadata unavailable")).toBeTruthy();
  });
});

describe("App Query Lab", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders Query Lab as a first-class route and previews row-shaped findMany results", async () => {
    const fetchMock = mockApiResponses({
      models: [model("User", ["id", "email"]), model("Post", ["id", "title"])],
      rowsByModel: {},
      previewRowsByModel: {
        User: [
          {
            id: "user_1",
            email: "ada@example.com",
          },
        ],
      },
    });

    renderApp("/query-lab");

    expect(await screen.findByRole("heading", { name: "Query Lab" })).toBeTruthy();
    expect(screen.getByLabelText("Query Lab model")).toBeTruthy();
    expect(screen.getByLabelText("Query Lab operation")).toHaveProperty("value", "findMany");
    expect(within(screen.getByLabelText("Query Lab operation")).getByText("findFirst")).toBeTruthy();
    expect(within(screen.getByLabelText("Query Lab operation")).getByText("findUnique")).toBeTruthy();
    expect(within(screen.getByLabelText("Query Lab operation")).getByText("count")).toBeTruthy();
    expect(screen.getByLabelText("Args Mode editor")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/query-lab/preview",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "User",
            operation: "findMany",
            argsSource: "{}",
          }),
        }),
      );
    });
    expect((await screen.findAllByText("ada@example.com")).length).toBeGreaterThan(0);
    expect(screen.getByRole("table", { name: "Query Lab table result" })).toBeTruthy();
    expect(screen.getAllByText("id").length).toBeGreaterThan(1);
    expect(screen.getAllByText("email").length).toBeGreaterThan(1);
    await openQueryLabContextPanel();
    expect(screen.getByText("take: safety default 25 applied")).toBeTruthy();
    expect(screen.queryByText("All displayed args came from the editor input.")).toBeNull();
  });

  it("switches Query Lab row-shaped results between table and JSON views", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
      previewRowsByModel: {
        User: [
          {
            id: "user_1",
            email: "ada@example.com",
          },
        ],
      },
    });

    renderApp("/query-lab");

    await screen.findByLabelText("Args Mode editor");
    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    expect(await screen.findByRole("table", { name: "Query Lab table result" })).toBeTruthy();

    await userEvent.click(screen.getAllByRole("button", { name: "JSON" })[0]);

    const jsonResult = screen.getByLabelText("Query Lab JSON result");
    expect(jsonResult.textContent).toBe(
      JSON.stringify([{ email: "ada@example.com", id: "user_1" }], null, 2),
    );
    expect(screen.queryByRole("table", { name: "Query Lab table result" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("table", { name: "Query Lab table result" })).toBeTruthy();
  });

  it("selects Query Lab rows and renders a reusable record preview", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
      previewRowsByModel: {
        User: [
          { id: "user_1", email: "ada@example.com" },
          { id: "user_2", email: "grace@example.com" },
        ],
      },
    });

    renderApp("/query-lab");

    await screen.findByLabelText("Args Mode editor");
    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    await openQueryLabContextPanel();
    expect(await screen.findByLabelText("Query Lab record preview")).toBeTruthy();
    expect(screen.getByLabelText("Select Query Lab result row 1").getAttribute("aria-selected")).toBe(
      "true",
    );

    await userEvent.click(screen.getByLabelText("Select Query Lab result row 2"));

    const preview = screen.getByLabelText("Query Lab record preview");
    expect(screen.getByLabelText("Select Query Lab result row 2").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(within(preview).getByText("user_2")).toBeTruthy();
    expect(within(preview).getByText("grace@example.com")).toBeTruthy();
    expect(within(preview).queryByText("ada@example.com")).toBeNull();
  });

  it("keeps nested Query Lab result values readable in table, JSON, and record preview", async () => {
    mockApiResponses({
      models: [
        {
          ...model("User", ["id", "profile", "posts"]),
          fields: [
            field("id", "String"),
            field("profile", "Json"),
            field("posts", "Post", "object"),
          ],
        },
      ],
      rowsByModel: {},
      previewRowsByModel: {
        User: [
          {
            id: "user_1",
            profile: { role: "admin", flags: ["beta"] },
            posts: [{ id: "post_1", title: "Nested result" }],
          },
        ],
      },
    });

    renderApp("/query-lab");

    await screen.findByLabelText("Args Mode editor");
    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    expect(
      (await screen.findAllByText('{"role":"admin","flags":["beta"]}')).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('[{"id":"post_1","title":"Nested result"}]').length).toBeGreaterThan(
      0,
    );

    await openQueryLabContextPanel();
    const preview = screen.getByLabelText("Query Lab record preview");
    expect(within(preview).getByText("profile")).toBeTruthy();
    expect(within(preview).getByText('{"role":"admin","flags":["beta"]}')).toBeTruthy();
    expect(within(preview).getByText('[{"id":"post_1","title":"Nested result"}]')).toBeTruthy();

    await userEvent.click(screen.getAllByRole("button", { name: "JSON" })[0]);

    const jsonResult = screen.getByLabelText("Query Lab JSON result");
    expect(jsonResult.textContent).toContain(
      '"profile": {\n      "flags": [\n        "beta"\n      ],\n      "role": "admin"\n    }',
    );
    expect(jsonResult.textContent).toContain('"posts": [\n      {\n        "id": "post_1"');
  });

  it.each([
    ["findFirst", { id: "user_1", email: "first@example.com" }, "first@example.com"],
    ["findUnique", { id: "user_2", email: "unique@example.com" }, "unique@example.com"],
  ] as const)("previews single-record %s results", async (operation, result, expectedText) => {
    const fetchMock = mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
      previewResultsByOperation: {
        [operation]: result,
      },
    });

    renderApp("/query-lab");

    await screen.findByLabelText("Args Mode editor");
    await userEvent.selectOptions(screen.getByLabelText("Query Lab operation"), operation);
    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/query-lab/preview",
        expect.objectContaining({
          body: JSON.stringify({
            model: "User",
            operation,
            argsSource: "{}",
          }),
        }),
      );
    });
    expect((await screen.findAllByText(expectedText)).length).toBeGreaterThan(0);
  });

  it.each(["findFirst", "findUnique"] as const)(
    "shows an empty result state for %s misses",
    async (operation) => {
      mockApiResponses({
        models: [model("User", ["id", "email"])],
        rowsByModel: {},
        previewResultsByOperation: {
          [operation]: null,
        },
      });

      renderApp("/query-lab");

      await screen.findByLabelText("Args Mode editor");
      await userEvent.selectOptions(screen.getByLabelText("Query Lab operation"), operation);
      await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

      expect(
        await screen.findByText(`No record matched this ${operation} query.`),
      ).toBeTruthy();
    },
  );

  it("renders Query Lab count as a scalar result", async () => {
    const fetchMock = mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
      previewResultsByOperation: {
        count: 42,
      },
    });

    renderApp("/query-lab");

    await screen.findByLabelText("Args Mode editor");
    await userEvent.selectOptions(screen.getByLabelText("Query Lab operation"), "count");
    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/query-lab/preview",
        expect.objectContaining({
          body: JSON.stringify({
            model: "User",
            operation: "count",
            argsSource: "{}",
          }),
        }),
      );
    });
    expect(await screen.findByText("Count")).toBeTruthy();
    expect(screen.getAllByText("42").length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the Query Inspector with capped normalized args and a copyable Prisma call", async () => {
    const fetchMock = mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
      previewRowsByModel: {
        User: [{ id: "user_1", email: "ada@example.com" }],
      },
    });

    renderApp("/query-lab");

    const editor = await screen.findByLabelText("Args Mode editor");
    fireEvent.input(editor, {
      currentTarget: {
        textContent:
          '{"where":{"email":{"contains":"example.com"}},"take":500}',
      },
      target: {
        textContent:
          '{"where":{"email":{"contains":"example.com"}},"take":500}',
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/query-lab/preview",
        expect.objectContaining({
          body: JSON.stringify({
            model: "User",
            operation: "findMany",
            argsSource: '{"where":{"email":{"contains":"example.com"}},"take":500}',
          }),
        }),
      );
    });

    await openQueryLabContextPanel();
    expect(await screen.findByLabelText("Query Inspector")).toBeTruthy();
    expect(screen.getByText("User.findMany")).toBeTruthy();
    expect(screen.getByText("take: capped from 500 to 100")).toBeTruthy();
    expect(screen.getByLabelText("Normalized Query Lab args").textContent).toContain(
      '"take": 100',
    );
    expect(screen.getByLabelText("Normalized Query Lab args").textContent).toContain(
      '"email"',
    );
    expect(screen.getByLabelText("Prisma Client call").textContent).toContain(
      "prisma.user.findMany",
    );
    expect(screen.getByLabelText("Query Lab safety limits").textContent).toContain(
      "Args depth",
    );
    expect(screen.getByLabelText("Query Lab safety limits").textContent).toContain(
      "Response size",
    );
    expect(screen.getByRole("button", { name: "Copy Prisma Client call" })).toBeTruthy();
  });

  it("formats Query Lab args in the editor", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
    });

    renderApp("/query-lab");

    const editor = await screen.findByLabelText("Args Mode editor");
    fireEvent.input(editor, {
      currentTarget: {
        textContent: '{"where":{"email":{"contains":"example.com"}},"take":25}',
      },
      target: {
        textContent: '{"where":{"email":{"contains":"example.com"}},"take":25}',
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "Format Query Lab args" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Args Mode editor").textContent).toBe(`{
  where: {
    email: {
      contains: "example.com"
    }
  },
  take: 25
}`);
    });
  });

  it("shows a toast when Query Lab args formatting fails", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
    });

    renderApp("/query-lab");

    const editor = await screen.findByLabelText("Args Mode editor");
    fireEvent.input(editor, {
      currentTarget: { textContent: "{ where: makeWhere() }" },
      target: { textContent: "{ where: makeWhere() }" },
    });

    await userEvent.click(screen.getByRole("button", { name: "Format Query Lab args" }));

    expect(toast.error).toHaveBeenCalledWith("Args Mode source contains unsupported syntax.");
    expect(screen.getByLabelText("Args Mode editor").textContent).toBe(
      "{ where: makeWhere() }",
    );
  });

  it("shows Query Lab safety limit API errors clearly", async () => {
    mockApiResponses({
      models: [model("User", ["id"])],
      rowsByModel: {},
      previewRowsByModel: {
        User: new Error(
          "Query Lab safety limit exceeded: serialized response size 300000 bytes exceeds the maximum of 262144 bytes.",
        ),
      },
    });

    renderApp("/query-lab");

    await screen.findByLabelText("Args Mode editor");
    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    expect(await screen.findByText("Could not run preview.")).toBeTruthy();
    expect(
      screen.getByText(
        "Query Lab safety limit exceeded: serialized response size 300000 bytes exceeds the maximum of 262144 bytes.",
      ),
    ).toBeTruthy();
  });

  it("renders Query Lab timing, SQL, params, and missing SQL empty states", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
      previewRowsByModel: {
        User: [{ id: "user_1", email: "ada@example.com" }],
      },
      queryLabDiagnostics: {
        timing: { durationMs: 18.25 },
        sql: {
          events: [
            {
              query: 'SELECT "User"."id", "User"."email" FROM "User" WHERE "User"."id" = ?',
              params: '["user_1"]',
              durationMs: 7,
            },
            {
              durationMs: 2,
            },
          ],
        },
      },
    });

    renderApp("/query-lab");

    await screen.findByLabelText("Args Mode editor");
    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    await openQueryLabContextPanel();
    expect((await screen.findByLabelText("Query Lab duration")).textContent).toBe("18.3 ms");
    expect(screen.getByLabelText("Query Lab SQL events")).toBeTruthy();
    expect(screen.getByLabelText("Query Lab SQL 1").textContent).toContain(
      'SELECT "User"."id"',
    );
    expect(screen.getByLabelText("Query Lab SQL params 1").textContent).toContain(
      '["user_1"]',
    );
    expect(screen.getByRole("button", { name: "Copy Query Lab SQL 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Query Lab SQL params 1" })).toBeTruthy();
    expect(screen.getByText("SQL text was not provided for this event.")).toBeTruthy();
    expect(screen.getByText("SQL params were not provided for this event.")).toBeTruthy();
  });

  it("renders Query Lab performance warnings in the inspector", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
      previewRowsByModel: {
        User: [{ id: "user_1", email: "ada@example.com" }],
      },
      queryLabDiagnostics: {
        warnings: [
          {
            code: "NON_UNIQUE_FILTER",
            path: "where.email",
            message:
              "where.email filters on User.email, which is not marked id or unique in Prisma metadata. This may scan more rows than expected.",
          },
        ],
      },
    });

    renderApp("/query-lab");

    await screen.findByLabelText("Args Mode editor");
    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    await openQueryLabContextPanel();
    const warnings = await screen.findByLabelText("Query Lab warnings");
    expect(within(warnings).getByText("where.email")).toBeTruthy();
    expect(
      within(warnings).getByText(
        "where.email filters on User.email, which is not marked id or unique in Prisma metadata. This may scan more rows than expected.",
      ),
    ).toBeTruthy();
  });

  it("shows Query Lab loading and error states", async () => {
    mockApiResponses({
      models: [model("User", ["id"])],
      rowsByModel: {},
      previewRowsByModel: {
        User: new Error("invalid args"),
      },
    });

    renderApp("/query-lab");

    await screen.findByLabelText("Args Mode editor");
    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    expect(await screen.findByText("Could not run preview.")).toBeTruthy();
    expect(screen.getByText("invalid args")).toBeTruthy();
  });

  it("wires Query Lab editor diagnostics into Monaco markers", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
    });

    renderApp("/query-lab");

    const editor = await screen.findByLabelText("Args Mode editor");
    fireEvent.input(editor, {
      currentTarget: { textContent: "{ cursor: { id: \"user_1\" } }" },
      target: { textContent: "{ cursor: { id: \"user_1\" } }" },
    });

    await waitFor(() => {
      expect(monacoSetModelMarkers).toHaveBeenLastCalledWith(
        expect.anything(),
        "query-lab-assist",
        expect.arrayContaining([
          expect.objectContaining({
            message: "Unsupported Query Lab findMany arg: cursor.",
          }),
        ]),
      );
    });
  });

  it("uses a dedicated Query Lab Monaco language for completions", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
    });

    renderApp("/query-lab");

    await screen.findByLabelText("Args Mode editor");

    expect(monacoRegisterLanguage).toHaveBeenCalledWith({ id: "query-lab-args" });
    expect(monacoSetMonarchTokensProvider).toHaveBeenCalledWith(
      "query-lab-args",
      expect.anything(),
    );
    expect(monacoRegisterCompletionItemProvider).toHaveBeenCalledWith(
      "query-lab-args",
      expect.anything(),
    );
    expect(monacoDefineTheme).toHaveBeenCalledWith(
      "query-lab-theme",
      expect.objectContaining({
        colors: expect.objectContaining({
          "editor.background": "#101319",
          "editorGutter.background": "#14181f",
        }),
      }),
    );
  });

  it("opens a model-specific Query Lab route with the model preselected", async () => {
    const fetchMock = mockApiResponses({
      models: [model("User", ["id", "email"]), model("Post", ["id", "title"])],
      rowsByModel: {},
      previewRowsByModel: {
        Post: [{ id: "post_1", title: "Query Lab notes" }],
      },
    });

    renderApp("/query-lab/Post");

    expect(await screen.findByRole("heading", { name: "Query Lab" })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText("Query Lab model")).toHaveProperty("value", "Post"),
    );

    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/query-lab/preview",
        expect.objectContaining({
          body: JSON.stringify({
            model: "Post",
            operation: "findMany",
            argsSource: "{}",
          }),
        }),
      );
    });
    expect((await screen.findAllByText("Query Lab notes")).length).toBeGreaterThan(0);
  });

  it("shows a stale model state for invalid Query Lab model routes", async () => {
    const fetchMock = mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {},
      previewRowsByModel: {
        User: [{ id: "user_1", email: "ada@example.com" }],
      },
    });

    renderApp("/query-lab/Missing");

    expect(await screen.findByText("Model not found.")).toBeTruthy();
    expect(screen.getByText(/Model "Missing" is no longer available/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Run Query Lab preview" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("button", { name: "User" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "User" }));
    await waitFor(() => expect(window.location.pathname).toBe("/query-lab/User"));
    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/query-lab/preview",
        expect.objectContaining({
          body: JSON.stringify({
            model: "User",
            operation: "findMany",
            argsSource: "{}",
          }),
        }),
      );
    });
    expect((await screen.findAllByText("ada@example.com")).length).toBeGreaterThan(0);
  });

  it("navigates from a model page into Query Lab for the current model", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"]), model("Post", ["id", "title"])],
      rowsByModel: {
        User: [],
        Post: [{ id: "post_1", title: "Routing test" }],
      },
    });

    renderApp("/model/Post");

    expect(await screen.findByText("Routing test")).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "Open Query Lab for Post" }));

    await waitFor(() => expect(window.location.pathname).toBe("/query-lab/Post"));
    expect(await screen.findByRole("heading", { name: "Query Lab" })).toBeTruthy();
    expect(screen.getByLabelText("Query Lab model")).toHaveProperty("value", "Post");
  });

  it("saves, reopens, renames, and deletes local Query Lab views", async () => {
    const fetchMock = mockApiResponses({
      models: [model("User", ["id", "email"]), model("Post", ["id", "title"])],
      rowsByModel: {},
      previewResultsByOperation: {
        findFirst: { id: "post_1", title: "Saved view result" },
      },
    });

    const { unmount } = renderApp("/query-lab");

    await screen.findByLabelText("Args Mode editor");
    await waitFor(() =>
      expect(screen.getByLabelText("Query Lab model")).toHaveProperty("value", "User"),
    );
    await userEvent.selectOptions(screen.getByLabelText("Query Lab model"), "Post");
    await userEvent.selectOptions(screen.getByLabelText("Query Lab operation"), "findFirst");

    const argsSource = '{"where":{"id":"post_1"},"select":{"id":true,"title":true}}';
    fireEvent.input(screen.getByLabelText("Args Mode editor"), {
      currentTarget: { textContent: argsSource },
      target: { textContent: argsSource },
    });

    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));
    expect(await screen.findByRole("table", { name: "Query Lab table result" })).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "JSON" })[0]);

    await userEvent.type(screen.getByLabelText("Saved Query Lab view name"), "Post lookup");
    await userEvent.click(screen.getByRole("button", { name: "Save Query Lab view" }));

    const storageKey = "prisma-pad.query-lab.saved-views.v1";
    const savedViews = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as Array<{
      name?: string;
      argsSource?: string;
      resultMode?: string;
    }>;
    expect(savedViews[0]).toMatchObject({
      name: "Post lookup",
      argsSource,
      resultMode: "json",
    });

    unmount();
    renderApp("/query-lab");

    expect(
      await screen.findByRole("button", { name: "Open saved Query Lab view Post lookup" }),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Open saved Query Lab view Post lookup" }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Query Lab model")).toHaveProperty("value", "Post"),
    );
    expect(screen.getByLabelText("Query Lab operation")).toHaveProperty("value", "findFirst");
    expect(screen.getByLabelText("Args Mode editor").textContent).toBe(argsSource);

    await userEvent.click(screen.getByRole("button", { name: "Run Query Lab preview" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/query-lab/preview",
        expect.objectContaining({
          body: JSON.stringify({
            model: "Post",
            operation: "findFirst",
            argsSource,
          }),
        }),
      );
    });
    expect(await screen.findByLabelText("Query Lab JSON result")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Query Lab table result" })).toBeNull();

    vi.stubGlobal("prompt", vi.fn(() => "Published post lookup"));
    await userEvent.click(
      screen.getByRole("button", { name: "Rename saved Query Lab view Post lookup" }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Open saved Query Lab view Published post lookup",
      }),
    ).toBeTruthy();
    expect(window.localStorage.getItem(storageKey)).toContain("Published post lookup");

    await userEvent.click(
      screen.getByRole("button", {
        name: "Delete saved Query Lab view Published post lookup",
      }),
    );
    expect(
      screen.queryByRole("button", {
        name: "Open saved Query Lab view Published post lookup",
      }),
    ).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBe("[]");
  });
});

describe("App row table", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads rows for the selected model and formats scalar values in the center table", async () => {
    const fetchMock = mockApiResponses({
      models: [
        {
          ...model("User", ["id", "email", "createdAt", "profile", "notes"]),
          fields: [
            field("id", "String"),
            field("email", "String"),
            field("createdAt", "DateTime"),
            field("profile", "Json"),
            field("posts", "Post", "object"),
            field("notes", "String", "scalar", false),
          ],
        },
      ],
      rowsByModel: {
        User: [
          {
            id: 1,
            email: "avery.long.email.address@example.com",
            createdAt: "2026-05-27T14:30:00.000Z",
            profile: { role: "admin", flags: ["beta"] },
            notes: null,
          },
        ],
      },
    });

    renderApp();

    expect(await screen.findByText("1 row loaded, 5 columns shown")).toBeTruthy();
    expect(screen.getByText("avery.long.email.address@example.com")).toBeTruthy();
    expect(screen.getByText('{"role":"admin","flags":["beta"]}')).toBeTruthy();
    expect(screen.getByText("NULL")).toBeTruthy();
    expect(screen.queryByText("posts")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/models/User/rows?page=1&pageSize=100",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("renders row loading, empty, and error states", async () => {
    mockApiResponses({
      models: [model("User", ["id"])],
      rowsByModel: { User: "pending" },
    });
    const { unmount } = renderApp();
    expect(await screen.findByText("Loading rows...")).toBeTruthy();
    unmount();

    mockApiResponses({
      models: [model("User", ["id"])],
      rowsByModel: { User: [] },
    });
    renderApp();
    expect(await screen.findByText("No rows found for this model.")).toBeTruthy();
    cleanup();

    mockApiResponses({
      models: [model("User", ["id"])],
      rowsByModel: { User: new Error("database disconnected") },
    });
    renderApp();
    expect(await screen.findByText("Could not load rows.")).toBeTruthy();
    expect(screen.getByText("database disconnected")).toBeTruthy();
  });

  it("shows API row errors in a toast with the backend message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/models") {
          return {
            ok: true,
            json: async () => ({ models: [model("User", ["id"])] }),
          };
        }

        if (url === "/api/models/User/rows?page=1&pageSize=100") {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: {
                code: "INVALID_FILTER",
                message: "Field age supports only equals, empty, or not empty filters.",
              },
            }),
          };
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      }),
    );

    renderApp();

    expect(await screen.findByText("Could not load rows.")).toBeTruthy();
    expect(
      screen.getByText("Field age supports only equals, empty, or not empty filters."),
    ).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith("Could not load rows", {
      description: "Field age supports only equals, empty, or not empty filters.",
    });
  });

  it("refreshes the selected model rows without exposing mutation controls", async () => {
    let userRows: Record<string, unknown>[] = [
      { id: "user_1", email: "ada@example.com" },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/models") {
        return {
          ok: true,
          json: async () => ({ models: [model("User", ["id", "email"])] }),
        };
      }

      if (url === "/api/models/User/rows?page=1&pageSize=100") {
        return {
          ok: true,
          json: async () => ({ model: "User", rows: userRows }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    expect(await screen.findByText("ada@example.com")).toBeTruthy();
    expect(screen.queryByText("Read-only")).toBeNull();
    expect(screen.queryByRole("button", { name: /create|edit|delete|save|update/i })).toBeNull();

    userRows = [{ id: "user_2", email: "grace@example.com" }];
    await userEvent.click(screen.getByRole("button", { name: "Refresh User rows" }));

    expect(await screen.findByText("grace@example.com")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("ada@example.com")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/models/User/rows?page=1&pageSize=100",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("requests server-controlled pagination and sorting from the table state", async () => {
    const pageOneRows = Array.from({ length: 100 }, (_, index) => ({
      id: `user_${index + 1}`,
      email: `user${index + 1}@example.com`,
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/models") {
        return {
          ok: true,
          json: async () => ({ models: [model("User", ["id", "email"])] }),
        };
      }

      const requestUrl = new URL(url, "http://localhost");
      if (requestUrl.pathname === "/api/models/User/rows") {
        const page = requestUrl.searchParams.get("page");
        const pageSize = requestUrl.searchParams.get("pageSize");
        const sort = requestUrl.searchParams.get("sort");

        if (page === "1" && pageSize === "100" && sort?.includes('"direction":"asc"')) {
          return {
            ok: true,
            json: async () => ({
              model: "User",
              rows: [{ id: "user_1", email: "a@example.com" }],
              pagination: { page: 1, pageSize: 100 },
            }),
          };
        }

        if (page === "2" && pageSize === "100") {
          return {
            ok: true,
            json: async () => ({
              model: "User",
              rows: [{ id: "user_101", email: "page2@example.com" }],
              pagination: { page: 2, pageSize: 100 },
            }),
          };
        }

        if (page === "1" && pageSize === "25") {
          return {
            ok: true,
            json: async () => ({
              model: "User",
              rows: [{ id: "user_25", email: "page-size-25@example.com" }],
              pagination: { page: 1, pageSize: 25 },
            }),
          };
        }

        return {
          ok: true,
          json: async () => ({
            model: "User",
            rows: pageOneRows,
            pagination: { page: 1, pageSize: 100 },
          }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    expect(await screen.findByText("user100@example.com")).toBeTruthy();
    expect(screen.getByText("Page 1")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("page2@example.com")).toBeTruthy();
    expect(screen.getByText("Page 2")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("page=2&pageSize=100")),
    ).toBe(true);

    await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "25");
    expect(await screen.findByText("page-size-25@example.com")).toBeTruthy();
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("page=1&pageSize=25")),
    ).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Sort by email" }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const sort = new URL(String(input), "http://localhost").searchParams.get("sort");
          return sort?.includes('"field":"email"') && sort.includes('"direction":"asc"');
        }),
      ).toBe(true);
    });
  });

  it("restores pagination from the model URL", async () => {
    const fetchMock = mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {
        User: [{ id: "user_26", email: "page-two@example.com" }],
      },
    });

    renderApp("/model/User?page=2&pageSize=25");

    expect(await screen.findByText("page-two@example.com")).toBeTruthy();
    expect(screen.getByText("Page 2")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/models/User/rows?page=2&pageSize=25",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("writes table interactions to the model URL", async () => {
    const pageOneRows = Array.from({ length: 100 }, (_, index) => ({
      id: `user_${index + 1}`,
      email: `user${index + 1}@example.com`,
    }));
    mockApiResponses({
      models: [model("User", ["id", "email", "role"])],
      rowsByModel: {
        User: pageOneRows,
      },
    });

    renderApp();

    await screen.findByText("user100@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(window.location.search).toContain("page=2"));

    await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "25");
    await waitFor(() => expect(window.location.search).toContain("pageSize=25"));
    expect(window.location.search).not.toContain("page=2");

    await userEvent.click(screen.getByRole("button", { name: "Sort by email" }));
    await waitFor(() =>
      expect(decodeURIComponent(window.location.search)).toContain("sort=email:asc"),
    );

    await userEvent.type(screen.getByLabelText("Search table rows"), "grace");
    await waitFor(() => expect(window.location.search).toContain("search=grace"));

    await userEvent.click(screen.getByRole("button", { name: "Add table filter" }));
    await userEvent.selectOptions(screen.getByLabelText("Filter field"), "role");
    await userEvent.selectOptions(screen.getByLabelText("Filter operator"), "equals");
    await userEvent.type(screen.getByLabelText("Filter value"), "admin");
    await waitFor(() => expect(window.location.search).toContain("filters="));

    await userEvent.click(screen.getByText("user1@example.com"));
    await waitFor(() => expect(window.location.search).toContain("row=0"));
  });

  it("restores search, filters, and sorting from the model URL", async () => {
    const filters = encodeURIComponent(
      JSON.stringify([{ field: "role", operator: "equals", value: "admin" }]),
    );
    const fetchMock = mockApiResponses({
      models: [model("User", ["id", "email", "role"])],
      rowsByModel: {
        User: [{ id: "user_1", email: "grace@example.com", role: "admin" }],
      },
    });

    renderApp(`/model/User?search=grace&filters=${filters}&sort=email:asc`);

    expect(await screen.findByText("grace@example.com")).toBeTruthy();
    expect((screen.getByLabelText("Search table rows") as HTMLInputElement).value).toBe(
      "grace",
    );
    expect((screen.getByLabelText("Filter field") as HTMLSelectElement).value).toBe(
      "role",
    );
    expect((screen.getByLabelText("Filter operator") as HTMLSelectElement).value).toBe(
      "equals",
    );
    expect((screen.getByLabelText("Filter value") as HTMLInputElement).value).toBe(
      "admin",
    );
    expect(window.location.search).toContain("sort=email:asc");
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = new URL(String(input), "http://localhost");
          return (
            url.searchParams.get("search") === "grace" &&
            url.searchParams.get("filters")?.includes('"field":"role"') &&
            url.searchParams.get("sort")?.includes('"field":"email"')
          );
        }),
      ).toBe(true);
    });
  });

  it("renders a read-only table query inspector that follows table controls", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mockApiResponses({
      models: [model("User", ["id", "email", "role"])],
      rowsByModel: {
        User: [
          { id: "user_1", email: "ada@example.com", role: "admin" },
          { id: "user_2", email: "grace@example.com", role: "member" },
        ],
      },
    });

    renderApp();

    await screen.findByText("ada@example.com");
    await openModelContextPanel();
    await userEvent.click(screen.getByRole("button", { name: "Show table query inspector" }));

    expect(screen.getByLabelText("Table Query Inspector")).toBeTruthy();
    expect(screen.getByText("User.findMany via prisma.user")).toBeTruthy();
    expect(screen.getByLabelText("Table Prisma Client call").textContent).toContain(
      "prisma.user.findMany",
    );
    expect(screen.getByLabelText("Table query args").textContent).toContain('"skip": 0');
    expect(screen.getByLabelText("Table query args").textContent).toContain('"take": 100');
    expect(screen.getByLabelText("Table query contributors").textContent).toContain(
      "Visible scalar and enum fields contributed to select",
    );
    expect(screen.queryByLabelText("Args Mode editor")).toBeNull();
    expect(screen.queryByRole("button", { name: "Run Query Lab preview" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Copy Prisma Client call" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("prisma.user.findMany"));
    expect(toast.success).toHaveBeenCalledWith("Copied to clipboard", {
      description: "Prisma Client call",
    });

    await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "25");
    await waitFor(() => {
      expect(screen.getByLabelText("Table query args").textContent).toContain('"take": 25');
      expect(screen.getByLabelText("Table query contributors").textContent).toContain(
        "Rows per page 25 contributed take: 25",
      );
    });

    await userEvent.click(screen.getByRole("button", { name: "Sort by email" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Table query args").textContent).toContain('"orderBy"');
      expect(screen.getByLabelText("Table query contributors").textContent).toContain(
        "email asc sort contributed to orderBy",
      );
    });

    await userEvent.type(screen.getByLabelText("Search table rows"), "grace");
    await waitFor(() => {
      expect(screen.getByLabelText("Table query args").textContent).toContain('"where"');
      expect(screen.getByLabelText("Table query args").textContent).toContain("grace");
      expect(screen.getByLabelText("Table query contributors").textContent).toContain(
        'Search "grace" contributed to where',
      );
    });
  });

  it("defaults the right sidebar to the table query when no row is selected", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {
        User: [{ id: "user_1", email: "ada@example.com" }],
      },
    });

    renderApp();

    await screen.findByText("ada@example.com");
    await openModelContextPanel();

    expect(screen.getAllByRole("heading", { name: "Table Query" }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Table Query Inspector")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Show table query inspector" })
        .getAttribute("data-state"),
    ).toBe("active");
    expect(screen.queryByText("Select a table row to inspect the full record.")).toBeNull();
  });

  it("drops stale filter, sort, and selected row URL values after metadata and rows load", async () => {
    const filters = encodeURIComponent(
      JSON.stringify([{ field: "missing", operator: "equals", value: "admin" }]),
    );
    const fetchMock = mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {
        User: [{ id: "user_1", email: "ada@example.com" }],
      },
    });

    renderApp(`/model/User?filters=${filters}&sort=missing:asc&row=5`);

    expect(await screen.findByText("ada@example.com")).toBeTruthy();
    expect(screen.queryByLabelText("Filter field")).toBeNull();
    await openModelContextPanel();
    expect(screen.getByLabelText("Table Query Inspector")).toBeTruthy();
    await waitFor(() => {
      expect(window.location.search).not.toContain("filters=");
      expect(window.location.search).not.toContain("sort=");
      expect(window.location.search).not.toContain("row=");
    });
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), "http://localhost");
        return (
          url.pathname === "/api/models/User/rows" &&
          !url.searchParams.has("filters") &&
          !url.searchParams.has("sort")
        );
      }),
    ).toBe(true);
  });

  it("restores the selected row from the model URL", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {
        User: [
          { id: "user_1", email: "ada@example.com" },
          { id: "user_2", email: "grace@example.com" },
        ],
      },
    });

    renderApp("/model/User?row=1");

    expect((await screen.findAllByText("grace@example.com")).length).toBeGreaterThan(0);
    expect(screen.getByRole("row", { name: "Select row 2" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await openModelContextPanel();
    expect(screen.getAllByText("user_2").length).toBeGreaterThan(1);
  });

  it("selects a table row and renders the record preview", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email"])],
      rowsByModel: {
        User: [
          { id: "user_1", email: "ada@example.com" },
          { id: "user_2", email: "grace@example.com" },
        ],
      },
    });

    renderApp();

    await openModelContextPanel();
    expect(await screen.findByLabelText("Table Query Inspector")).toBeTruthy();

    await userEvent.click(await screen.findByText("grace@example.com"));

    expect(screen.getByRole("row", { name: "Select row 2" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(
      screen.getByRole("row", { name: "Select row 1" }).getAttribute("aria-selected"),
    ).toBeNull();
    expect(screen.getAllByText("user_2").length).toBeGreaterThan(1);
    expect(screen.getAllByText("grace@example.com").length).toBeGreaterThan(1);
  });

  it("searches visible table columns and clears row search", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email", "role"])],
      rowsByModel: {
        User: [
          { id: "user_1", email: "ada@example.com", role: "admin" },
          { id: "user_2", email: "grace@example.com", role: "member" },
        ],
      },
    });

    renderApp();

    await screen.findByText("ada@example.com");
    await userEvent.type(screen.getByLabelText("Search table rows"), "grace");

    await waitFor(() => {
      expect(screen.getByText("1 match loaded, 3 columns shown")).toBeTruthy();
      expect(screen.queryByText("ada@example.com")).toBeNull();
      expect(screen.getByText("grace@example.com")).toBeTruthy();
    });

    await userEvent.clear(screen.getByLabelText("Search table rows"));
    await waitFor(() => {
      expect(screen.getByText("2 rows loaded, 3 columns shown")).toBeTruthy();
      expect(screen.getByText("ada@example.com")).toBeTruthy();
    });
  });

  it("keeps the row search focused and previous rows visible while debounced search loads", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/models") {
        return {
          ok: true,
          json: async () => ({ models: [model("User", ["id", "email"])] }),
        };
      }

      if (url === "/api/models/User/rows?page=1&pageSize=100") {
        return {
          ok: true,
          json: async () => ({
            model: "User",
            rows: [{ id: "user_1", email: "ada@example.com" }],
          }),
        };
      }

      if (url.includes("search=grace")) {
        return new Promise(() => undefined);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await screen.findByText("ada@example.com");
    const searchInput = screen.getByLabelText("Search table rows");
    await userEvent.type(searchInput, "grace");

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes("search=grace")),
      ).toBe(true);
    });
    expect(document.activeElement).toBe(searchInput);
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.queryByText("No rows match the current search or filters.")).toBeNull();
  });

  it("filters table rows by column operator and shows an empty match state", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email", "role"])],
      rowsByModel: {
        User: [
          { id: "user_1", email: "ada@example.com", role: "admin" },
          { id: "user_2", email: "grace@example.com", role: "member" },
        ],
      },
    });

    renderApp();

    await screen.findByText("ada@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add table filter" }));
    await userEvent.selectOptions(screen.getByLabelText("Filter field"), "role");
    await userEvent.selectOptions(screen.getByLabelText("Filter operator"), "equals");
    await userEvent.type(screen.getByLabelText("Filter value"), "admin");

    await waitFor(() => {
      expect(screen.getByText("1 match loaded, 3 columns shown")).toBeTruthy();
      expect(screen.getByText("ada@example.com")).toBeTruthy();
      expect(screen.queryByText("grace@example.com")).toBeNull();
    });

    await userEvent.clear(screen.getByLabelText("Filter value"));
    await userEvent.type(screen.getByLabelText("Filter value"), "owner");

    await waitFor(() => {
      expect(screen.getByText("No rows match the current search or filters.")).toBeTruthy();
      expect(screen.getByText("0 matches loaded, 3 columns shown")).toBeTruthy();
    });
  });

  it("limits filter operators to choices supported by the selected field type", async () => {
    const fetchMock = mockApiResponses({
      models: [
        {
          ...model("User", ["id", "email", "age", "profile"]),
          fields: [
            field("id", "String"),
            field("email", "String"),
            field("age", "Int"),
            field("profile", "Json"),
          ],
        },
      ],
      rowsByModel: {
        User: [
          { id: "user_1", email: "ada@example.com", age: 37, profile: { role: "admin" } },
        ],
      },
    });

    renderApp();

    await screen.findByText("ada@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add table filter" }));
    await userEvent.selectOptions(screen.getByLabelText("Filter field"), "age");

    const fieldSelect = screen.getByLabelText("Filter field") as HTMLSelectElement;
    const operatorSelect = screen.getByLabelText("Filter operator") as HTMLSelectElement;
    expect([...fieldSelect.options].map((option) => option.value)).toEqual([
      "id",
      "email",
      "age",
    ]);
    expect([...operatorSelect.options].map((option) => option.value)).toEqual([
      "equals",
      "empty",
      "notEmpty",
    ]);
    expect(operatorSelect.value).toBe("equals");

    await userEvent.type(screen.getByLabelText("Filter value"), "37");

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = String(input);
          const rawFilters = new URL(url, "http://localhost").searchParams.get("filters");
          if (!rawFilters) return false;
          return rawFilters.includes('"field":"age"') && rawFilters.includes('"operator":"equals"');
        }),
      ).toBe(true);
    });
  });

  it("filters enum fields with a dropdown backed by metadata enum values", async () => {
    const fetchMock = mockApiResponses({
      models: [
        {
          ...model("User", ["id", "role"]),
          fields: [
            field("id", "String"),
            { ...field("role", "Role", "enum"), enumValues: ["ADMIN", "MEMBER"] },
          ],
        },
      ],
      rowsByModel: {
        User: [
          { id: "user_1", role: "ADMIN" },
          { id: "user_2", role: "MEMBER" },
        ],
      },
    });

    renderApp();

    await screen.findByText("user_1");
    await userEvent.click(screen.getByRole("button", { name: "Add table filter" }));
    await userEvent.selectOptions(screen.getByLabelText("Filter field"), "role");

    const valueSelect = screen.getByLabelText("Filter value") as HTMLSelectElement;
    expect(valueSelect.tagName).toBe("SELECT");
    expect([...valueSelect.options].map((option) => option.value)).toEqual([
      "ADMIN",
      "MEMBER",
    ]);
    expect(valueSelect.value).toBe("ADMIN");

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const rawFilters = new URL(String(input), "http://localhost").searchParams.get(
            "filters",
          );
          return rawFilters?.includes('"field":"role"') && rawFilters.includes('"value":"ADMIN"');
        }),
      ).toBe(true);
    });

    await userEvent.selectOptions(valueSelect, "MEMBER");
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const rawFilters = new URL(String(input), "http://localhost").searchParams.get(
            "filters",
          );
          return rawFilters?.includes('"field":"role"') && rawFilters.includes('"value":"MEMBER"');
        }),
      ).toBe(true);
    });
  });

  it("keeps rows returned by enum list filters visible after local filtering", async () => {
    const fetchMock = mockApiResponses({
      models: [
        {
          ...model("AdminProfile", ["id", "roles"]),
          fields: [
            field("id", "String"),
            {
              ...field("roles", "AdminRole", "enum"),
              enumValues: ["SYSTEM_ADMIN", "SUPPORT_ADMIN"],
              isList: true,
            },
          ],
        },
      ],
      rowsByModel: {
        AdminProfile: [
          { id: "admin_profile_1", roles: ["SYSTEM_ADMIN"] },
          { id: "admin_profile_2", roles: ["SUPPORT_ADMIN"] },
        ],
      },
    });

    renderApp("/model/AdminProfile");

    await screen.findByText("admin_profile_1");
    await userEvent.click(screen.getByRole("button", { name: "Add table filter" }));
    await userEvent.selectOptions(screen.getByLabelText("Filter field"), "roles");

    const valueSelect = screen.getByLabelText("Filter value") as HTMLSelectElement;
    expect(valueSelect.value).toBe("SYSTEM_ADMIN");

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const rawFilters = new URL(String(input), "http://localhost").searchParams.get(
            "filters",
          );
          return (
            rawFilters?.includes('"field":"roles"') &&
            rawFilters.includes('"value":"SYSTEM_ADMIN"')
          );
        }),
      ).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByText("1 match loaded, 2 columns shown")).toBeTruthy();
      expect(screen.getByText("admin_profile_1")).toBeTruthy();
      expect(screen.queryByText("admin_profile_2")).toBeNull();
      expect(screen.queryByText("No rows match the current search or filters.")).toBeNull();
    });
  });

  it("clears table search and filters together", async () => {
    mockApiResponses({
      models: [model("User", ["id", "email", "role"])],
      rowsByModel: {
        User: [
          { id: "user_1", email: "ada@example.com", role: "admin" },
          { id: "user_2", email: "grace@example.com", role: "member" },
        ],
      },
    });

    renderApp();

    await screen.findByText("ada@example.com");
    await userEvent.type(screen.getByLabelText("Search table rows"), "grace");
    await userEvent.click(screen.getByRole("button", { name: "Add table filter" }));
    await userEvent.selectOptions(screen.getByLabelText("Filter field"), "email");
    await userEvent.type(screen.getByLabelText("Filter value"), "example.com");

    await userEvent.click(
      screen.getByRole("button", { name: "Clear table search and filters" }),
    );

    await waitFor(() => {
      expect(screen.getByText("2 rows loaded, 3 columns shown")).toBeTruthy();
      expect(screen.getByText("ada@example.com")).toBeTruthy();
      expect(screen.getByText("grace@example.com")).toBeTruthy();
    });
    expect(screen.queryByLabelText("Filter field")).toBeNull();
    expect((screen.getByLabelText("Search table rows") as HTMLInputElement).value).toBe("");
  });

  it("keeps complex selected record values readable in the field preview", async () => {
    const longToken = "x".repeat(140);
    mockApiResponses({
      models: [
        {
          ...model("AuditLog", ["id", "payload", "tags", "description", "notes"]),
          fields: [
            field("id", "String"),
            field("payload", "Json"),
            field("tags", "Json"),
            field("description", "String"),
            field("notes", "String", "scalar", false),
          ],
        },
      ],
      rowsByModel: {
        AuditLog: [
          {
            id: "log_1",
            payload: { action: "invite.created", nested: { count: 2 } },
            tags: ["audit", "team"],
            description: longToken,
            notes: null,
          },
        ],
      },
    });

    renderApp("/model/AuditLog");

    await userEvent.click(await screen.findByText("log_1"));
    await openModelContextPanel();

    const previewValue = screen
      .getAllByText('{"action":"invite.created","nested":{"count":2}}')
      .find((element) => element.closest("dl"));
    const preview = previewValue?.closest("dl");

    expect(preview).toBeTruthy();
    expect(within(preview as HTMLElement).getByText("payload")).toBeTruthy();
    expect(
      within(preview as HTMLElement).getByText(
        '{"action":"invite.created","nested":{"count":2}}',
      ),
    ).toBeTruthy();
    expect(within(preview as HTMLElement).getByText('["audit","team"]')).toBeTruthy();
    expect(within(preview as HTMLElement).getByText(longToken)).toBeTruthy();
    expect(within(preview as HTMLElement).getByText("NULL")).toBeTruthy();
  });

  it("switches the selected record preview between fields and stable formatted JSON", async () => {
    const longToken = "token.".repeat(40);
    mockApiResponses({
      models: [
        {
          ...model("AuditLog", ["id", "payload", "tags", "description"]),
          fields: [
            field("id", "String"),
            field("payload", "Json"),
            field("tags", "Json"),
            field("description", "String"),
          ],
        },
      ],
      rowsByModel: {
        AuditLog: [
          {
            id: "log_1",
            payload: {
              zebra: "last",
              action: "invite.created",
              nested: { count: 2, actors: ["ada", "grace"] },
            },
            tags: ["audit", "team"],
            description: longToken,
          },
        ],
      },
    });

    renderApp("/model/AuditLog");

    await userEvent.click(await screen.findByText("log_1"));
    await openModelContextPanel();

    expect(
      screen.getAllByText(
        '{"zebra":"last","action":"invite.created","nested":{"count":2,"actors":["ada","grace"]}}',
      ).length,
    ).toBeGreaterThan(1);

    await userEvent.click(screen.getByRole("button", { name: "JSON" }));

    const jsonPreview = screen.getByLabelText("Selected record JSON preview");
    expect(jsonPreview.textContent).toBe(
      JSON.stringify(
        {
          description: longToken,
          id: "log_1",
          payload: {
            action: "invite.created",
            nested: { actors: ["ada", "grace"], count: 2 },
            zebra: "last",
          },
          tags: ["audit", "team"],
        },
        null,
        2,
      ),
    );
    expect(jsonPreview.textContent).toContain(
      '\n      "actors": [\n        "ada",\n        "grace"\n      ]',
    );

    await userEvent.click(screen.getByRole("button", { name: "Fields" }));

    expect(screen.queryByLabelText("Selected record JSON preview")).toBeNull();
    expect(screen.getAllByText(longToken).length).toBeGreaterThan(1);
  });
});

function model(name: string, fieldNames: string[]) {
  return {
    name,
    fields: fieldNames.map((fieldName) => field(fieldName, "String")),
  };
}

function field(
  name: string,
  type: string,
  kind: "scalar" | "object" | "enum" | "unsupported" = "scalar",
  isRequired = true,
) {
  return {
    name,
    kind,
    type,
    isList: false,
    isRequired,
    isUnique: false,
    isId: name === "id",
    hasDefaultValue: false,
    relationName: kind === "object" ? type : null,
  };
}

function mockApiResponses({
  models,
  rowsByModel,
  previewRowsByModel = {},
  previewResultsByOperation = {},
  queryLabDiagnostics = {},
}: {
  models: ReturnType<typeof model>[];
  rowsByModel: Record<string, Record<string, unknown>[] | Error | "pending">;
  previewRowsByModel?: Record<string, Record<string, unknown>[] | Error>;
  previewResultsByOperation?: Record<string, unknown>;
  queryLabDiagnostics?: {
    timing?: { durationMs?: number };
    sql?: { events?: QueryLabSqlEvent[] };
    warnings?: QueryLabWarning[];
  };
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/models") {
      return {
        ok: true,
        json: async () => ({ models }),
      };
    }

    const match = /^\/api\/models\/([^/]+)\/rows/.exec(url);
    if (match) {
      const modelName = decodeURIComponent(match[1]);
      const rows = rowsByModel[modelName] ?? [];
      if (rows === "pending") return new Promise(() => undefined);
      if (rows instanceof Error) throw rows;
      const requestUrl = new URL(url, "http://localhost");
      const modelMetadata = models.find((candidate) => candidate.name === modelName);

      return {
        ok: true,
        json: async () => ({
          model: modelName,
          rows,
          query: createMockTableQuery(modelMetadata, modelName, requestUrl.searchParams),
        }),
      };
    }

    if (url === "/api/query-lab/preview") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        model?: string;
        operation?: string;
        argsSource?: string;
      };
      const operation = body.operation ?? "findMany";
      const resultForOperation = previewResultsByOperation[operation];
      const rows = previewRowsByModel[body.model ?? ""] ?? [];
      if (rows instanceof Error) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: rows.message } }),
        };
      }

      return {
        ok: true,
        json: async () => {
          const parsedArgs = parseMockQueryLabArgs(body.argsSource);
          const normalized = normalizeMockQueryLabArgs(operation, parsedArgs);
          const result =
            resultForOperation !== undefined
              ? resultForOperation
              : operation === "findMany"
                ? rows
                : null;
          return {
            model: body.model,
            operation,
            args: normalized.args,
            normalizedArgs: normalized.args,
            normalization: normalized.normalization,
            warnings: queryLabDiagnostics.warnings ?? [],
            safetyLimits: {
              maxArgsDepth: 8,
              timeoutMs: 5000,
              maxResponseBytes: 262144,
              argsDepth: 1,
              responseSizeBytes: JSON.stringify(result).length,
            },
            prismaCall: formatMockPrismaCall(body.model, operation, normalized.args),
            timing: queryLabDiagnostics.timing ?? { durationMs: 1 },
            sql: queryLabDiagnostics.sql ?? { events: [] },
            result,
            rows: operation === "findMany" ? result : undefined,
          };
        },
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function parseMockQueryLabArgs(argsSource: string | undefined) {
  if (!argsSource) return {};
  try {
    const parsed = JSON.parse(argsSource) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to the lightweight parser used for object-literal defaults.
  }
  const takeMatch = /\btake\s*:\s*(\d+)/.exec(argsSource);
  return takeMatch ? { take: Number(takeMatch[1]) } : {};
}

function normalizeMockQueryLabArgs(operation: string, args: Record<string, unknown>) {
  if (operation !== "findMany") return { args, normalization: [] };
  const take = args.take;
  if (
    take === undefined ||
    take === null ||
    typeof take !== "number" ||
    !Number.isInteger(take) ||
    take < 1
  ) {
    return {
      args: { ...args, take: 25 },
      normalization: [
        {
          path: "take",
          action: "default",
          reason: "findManySafetyTake",
          value: 25,
        },
      ],
    };
  }
  if (typeof take === "number" && take > 100) {
    return {
      args: { ...args, take: 100 },
      normalization: [
        {
          path: "take",
          action: "cap",
          reason: "findManyMaxTake",
          originalValue: take,
          value: 100,
        },
      ],
    };
  }
  return { args, normalization: [] };
}

function formatMockPrismaCall(modelName: string | undefined, operation: string, args: unknown) {
  const delegateName = modelName
    ? `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`
    : "model";
  return `prisma.${delegateName}.${operation}(${JSON.stringify(args, null, 2)})`;
}

function createMockTableQuery(
  modelMetadata: ReturnType<typeof model> | undefined,
  modelName: string,
  searchParams: URLSearchParams,
) {
  const delegateName = `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "100");
  const fields =
    modelMetadata?.fields.filter((item) => item.kind === "scalar" || item.kind === "enum") ??
    [];
  const select = Object.fromEntries(fields.map((item) => [item.name, true]));
  const search = searchParams.get("search")?.trim() ?? "";
  const filters = parseMockTableFilters(searchParams.get("filters"));
  const where = createMockTableWhere(fields, search, filters);
  const orderBy = parseMockTableSort(searchParams.get("sort"));
  const args = {
    ...(where ? { where } : {}),
    ...(orderBy.length > 0 ? { orderBy } : {}),
    select,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
  const contributors = [
    ...(search && where
      ? [{ source: "search", label: `Search "${search}" contributed to where`, path: "where" }]
      : []),
    ...filters.map((filter) => ({
      source: "filter",
      label: `${filter.field} filter contributed to where`,
      path: "where",
    })),
    ...orderBy.map((sort) => {
      const [field, direction] = Object.entries(sort)[0] ?? [];
      return {
        source: "sort",
        label: `${field} ${direction} sort contributed to orderBy`,
        path: "orderBy",
      };
    }),
    {
      source: "select",
      label: "Visible scalar and enum fields contributed to select",
      path: "select",
    },
    {
      source: "page",
      label: `Page ${page} contributed skip: ${(page - 1) * pageSize}`,
      path: "skip",
    },
    {
      source: "pageSize",
      label: `Rows per page ${pageSize} contributed take: ${pageSize}`,
      path: "take",
    },
  ];

  return {
    model: modelName,
    delegateName,
    operation: "findMany",
    args,
    ...(where ? { where } : {}),
    ...(orderBy.length > 0 ? { orderBy } : {}),
    select,
    skip: (page - 1) * pageSize,
    take: pageSize,
    prismaCall: formatMockPrismaCall(modelName, "findMany", args),
    contributors,
  };
}

function parseMockTableFilters(rawFilters: string | null) {
  if (!rawFilters) return [];
  try {
    const parsed = JSON.parse(rawFilters) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is { field: string; operator: string; value?: string } =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as { field?: unknown }).field === "string" &&
        typeof (item as { operator?: unknown }).operator === "string",
    );
  } catch {
    return [];
  }
}

function parseMockTableSort(rawSort: string | null): Array<Record<string, "asc" | "desc">> {
  if (!rawSort) return [];
  try {
    const parsed = JSON.parse(rawSort) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { field?: unknown; direction?: unknown };
      if (
        typeof candidate.field !== "string" ||
        (candidate.direction !== "asc" && candidate.direction !== "desc")
      ) {
        return [];
      }
      return [{ [candidate.field]: candidate.direction }];
    });
  } catch {
    return [];
  }
}

function createMockTableWhere(
  fields: ReturnType<typeof field>[],
  search: string,
  filters: Array<{ field: string; operator: string; value?: string }>,
) {
  const and: Record<string, unknown>[] = [];
  const searchableFields = fields.filter((item) => item.kind === "scalar" && item.type === "String");
  if (search && searchableFields.length > 0) {
    and.push({
      OR: searchableFields.map((item) => ({ [item.name]: { contains: search } })),
    });
  }
  for (const filter of filters) {
    if (filter.operator === "empty") {
      and.push({ [filter.field]: null });
    } else if (filter.operator === "notEmpty") {
      and.push({ [filter.field]: { not: null } });
    } else if (filter.value) {
      and.push({ [filter.field]: { [filter.operator]: filter.value } });
    }
  }
  if (and.length === 0) return undefined;
  if (and.length === 1) return and[0];
  return { AND: and };
}

function mockPendingModelsResponse() {
  const fetchMock = vi.fn(() => new Promise(() => undefined));
  vi.stubGlobal("fetch", fetchMock);
}

function mockRejectedModelsResponse(error: Error) {
  const fetchMock = vi.fn(async () => {
    throw error;
  });
  vi.stubGlobal("fetch", fetchMock);
}

function renderApp(path = "/model/User") {
  vi.stubGlobal("scrollTo", vi.fn());
  window.history.replaceState(null, "", path);
  return render(<App />);
}

async function openModelContextPanel() {
  const showName = "Show record preview panel";
  const hideName = "Hide record preview panel";
  const button = await waitFor(() => {
    const showButton = screen.queryByRole("button", { name: showName });
    const hideButton = screen.queryByRole("button", { name: hideName });
    if (showButton || hideButton) return showButton ?? hideButton;
    throw new Error("Record preview panel toggle was not rendered.");
  });

  if (button.getAttribute("aria-label") === hideName) {
    return;
  }

  await userEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("button", { name: showName })).toBeNull());
}

async function openQueryLabContextPanel() {
  const name = "Show Query Lab context panel";
  const button = await screen.findByRole("button", { name });
  await userEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("button", { name })).toBeNull());
}
