// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app";

describe("App model sidebar", () => {
  afterEach(() => {
    cleanup();
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
      "/api/models/User/rows?page=1&pageSize=50",
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
