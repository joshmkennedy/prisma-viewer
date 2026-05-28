// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app";

vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return {
    ...actual,
    toast: {
      ...actual.toast,
      error: vi.fn(),
    },
  };
});

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

    render(<App />);

    expect(await screen.findByRole("button", { name: "User model, 2 fields" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AuditLog model, 3 fields" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "User model, 2 fields" }).getAttribute("aria-current"),
    ).toBe("true");
    expect(await screen.findByText("1 row loaded, 2 columns shown")).toBeTruthy();
    expect(screen.getByText("email")).toBeTruthy();
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

    render(<App />);

    const projectButton = await screen.findByRole("button", {
      name: "Project model, 3 fields",
    });
    await userEvent.click(projectButton);

    expect(projectButton.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("heading", { name: "Project" })).toBeTruthy();
    expect(await screen.findByText("1 row loaded, 3 columns shown")).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
  });

  it("renders loading, empty, and error states clearly", async () => {
    mockPendingModelsResponse();
    const { unmount } = render(<App />);
    expect(screen.getByText("Loading models...")).toBeTruthy();
    unmount();

    mockApiResponses({ models: [], rowsByModel: {} });
    render(<App />);
    expect(await screen.findByText("No Prisma models found.")).toBeTruthy();
    cleanup();

    mockRejectedModelsResponse(new Error("metadata unavailable"));
    render(<App />);
    expect(await screen.findByText("Could not load models.")).toBeTruthy();
    expect(screen.getByText("metadata unavailable")).toBeTruthy();
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

    render(<App />);

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
    const { unmount } = render(<App />);
    expect(await screen.findByText("Loading rows...")).toBeTruthy();
    unmount();

    mockApiResponses({
      models: [model("User", ["id"])],
      rowsByModel: { User: [] },
    });
    render(<App />);
    expect(await screen.findByText("No rows found for this model.")).toBeTruthy();
    cleanup();

    mockApiResponses({
      models: [model("User", ["id"])],
      rowsByModel: { User: new Error("database disconnected") },
    });
    render(<App />);
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

    render(<App />);

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

    render(<App />);

    expect(await screen.findByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText("Read-only")).toBeTruthy();
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

    render(<App />);

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

    render(<App />);

    expect(
      screen.getByText("Select a table row to inspect the full record."),
    ).toBeTruthy();

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

    render(<App />);

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

    render(<App />);

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

    render(<App />);

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

    render(<App />);

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

    render(<App />);

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

    render(<App />);

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

    render(<App />);

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

    render(<App />);

    await userEvent.click(await screen.findByText("log_1"));

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

    render(<App />);

    await userEvent.click(await screen.findByText("log_1"));

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
}: {
  models: ReturnType<typeof model>[];
  rowsByModel: Record<string, Record<string, unknown>[] | Error | "pending">;
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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

      return {
        ok: true,
        json: async () => ({ model: modelName, rows }),
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
