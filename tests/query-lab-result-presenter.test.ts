import { describe, expect, it } from "vitest";
import {
  createQueryLabResultViewModel,
  type QueryLabOperation,
  type QueryLabPreviewResponse,
} from "../src/query-lab-result-presenter";
import type { Field, Model } from "../src/domain/prisma-metadata";
import { formatJsonBlock, formatValue } from "../src/domain/row-formatting";

describe("createQueryLabResultViewModel", () => {
  it("returns loading, error, and empty states before preview result presentation", () => {
    expect(
      createQueryLabResultViewModel({
        preview: null,
        fallbackOperation: "findMany",
        selectedModel: null,
        selectedRowIndex: 0,
        isLoading: true,
      }),
    ).toEqual({ kind: "loading" });
    expect(
      createQueryLabResultViewModel({
        preview: null,
        fallbackOperation: "findMany",
        selectedModel: null,
        selectedRowIndex: 0,
        errorMessage: "invalid args",
      }),
    ).toEqual({ kind: "error", message: "invalid args" });
    expect(
      createQueryLabResultViewModel({
        preview: null,
        fallbackOperation: "findMany",
        selectedModel: null,
        selectedRowIndex: 0,
      }),
    ).toEqual({ kind: "empty" });
  });

  it("presents findMany array results as selectable rows with stable columns and JSON", () => {
    const viewModel = createRowsViewModel({
      preview: preview({
        result: [
          { id: "user_1", email: "ada@example.com" },
          { id: "user_2", name: "Grace" },
        ],
      }),
      selectedRowIndex: 1,
    });

    expect(viewModel.columns).toEqual(["id", "email", "name"]);
    expect(viewModel.selectedRow).toEqual({ id: "user_2", name: "Grace" });
    expect(viewModel.selectedFields.map((field) => field.name)).toEqual(["id", "name"]);
    expect(viewModel.resultJson).toBe(
      JSON.stringify(
        [
          { email: "ada@example.com", id: "user_1" },
          { id: "user_2", name: "Grace" },
        ],
        null,
        2,
      ),
    );
    expect(viewModel.selectedRecordJson).toBe(
      JSON.stringify({ id: "user_2", name: "Grace" }, null, 2),
    );
  });

  it.each([
    ["findFirst", { id: "user_1", email: "first@example.com" }],
    ["findUnique", { id: "user_2", email: "unique@example.com" }],
  ] as const)("presents %s object results as one selectable row", (operation, result) => {
    const viewModel = createRowsViewModel({
      preview: preview({ operation, result }),
      selectedRowIndex: 4,
    });

    expect(viewModel.rows).toEqual([result]);
    expect(viewModel.selectedRowIndex).toBe(0);
    expect(viewModel.selectedRow).toEqual(result);
    expect(viewModel.columns).toEqual(["id", "email"]);
  });

  it.each(["findFirst", "findUnique"] as const)(
    "presents %s null results as a single-record miss",
    (operation) => {
      const viewModel = createQueryLabResultViewModel({
        preview: preview({ operation, result: null }),
        fallbackOperation: "findMany",
        selectedModel: userModel(),
        selectedRowIndex: 0,
      });

      expect(viewModel).toMatchObject({
        kind: "singleMiss",
        operation,
        json: "null",
      });
    },
  );

  it("presents count results as a scalar count without table rows", () => {
    const viewModel = createQueryLabResultViewModel({
      preview: preview({ operation: "count", result: 42 }),
      fallbackOperation: "findMany",
      selectedModel: userModel(),
      selectedRowIndex: 0,
    });

    expect(viewModel).toMatchObject({
      kind: "count",
      value: 42,
      json: "42",
    });
  });

  it("falls back to JSON-only output for non-row result shapes", () => {
    const viewModel = createQueryLabResultViewModel({
      preview: preview({ result: { aggregate: { count: 2 } } }),
      fallbackOperation: "findMany",
      selectedModel: userModel(),
      selectedRowIndex: 0,
    });

    expect(viewModel).toMatchObject({
      kind: "jsonOnly",
      json: JSON.stringify({ aggregate: { count: 2 } }, null, 2),
    });
  });

  it("formats nested object and list values consistently for cells and stable JSON", () => {
    const value = { role: "admin", flags: ["beta"] };

    expect(formatValue(value)).toBe('{"role":"admin","flags":["beta"]}');
    expect(formatValue([{ id: "post_1", title: "Nested result" }])).toBe(
      '[{"id":"post_1","title":"Nested result"}]',
    );
    expect(formatJsonBlock({ profile: value })).toBe(`{
  "profile": {
    "flags": [
      "beta"
    ],
    "role": "admin"
  }
}`);
  });

  it("uses metadata fields and infers fallback field types for unknown result keys", () => {
    const viewModel = createRowsViewModel({
      preview: preview({
        result: [
          {
            id: "user_1",
            active: true,
            notes: null,
            profile: { role: "admin" },
            tags: ["beta"],
          },
        ],
      }),
      selectedModel: userModel([field("id", "String")]),
    });

    expect(viewModel.selectedFields).toEqual([
      field("id", "String"),
      field("active", "Boolean"),
      field("notes", "Unknown", "scalar", false, false),
      field("profile", "Json"),
      field("tags", "Json", "scalar", true),
    ]);
  });

  it("builds the inspector from normalized args, fallback Prisma call, diagnostics, and SQL events", () => {
    const viewModel = createRowsViewModel({
      preview: preview({
        args: { take: 500 },
        normalizedArgs: { take: 100 },
        normalization: [
          {
            action: "cap",
            path: "take",
            reason: "limit",
            originalValue: 500,
            value: 100,
          },
          {
            action: "default",
            path: "skip",
            reason: "offset",
            value: 0,
          },
        ],
        result: [{ id: "user_1" }],
        safetyLimits: {
          argsDepth: 2,
          maxArgsDepth: 8,
          timeoutMs: 1000,
          responseSizeBytes: 1536,
          maxResponseBytes: 262144,
        },
        timing: { durationMs: 18.25 },
        warnings: [{ code: "NON_UNIQUE_FILTER", path: "where.email", message: "scan risk" }],
        sql: {
          events: [
            { query: "SELECT 1", params: "[]", durationMs: 7 },
            { durationMs: 2 },
          ],
        },
      }),
    });

    expect(viewModel.inspector.title).toBe("User.findMany");
    expect(viewModel.inspector.normalizedArgsJson).toBe(`{
  "take": 100
}`);
    expect(viewModel.inspector.prismaCall).toContain("prisma.user.findMany");
    expect(viewModel.inspector.prismaCall).toContain('"take": 100');
    expect(viewModel.inspector.normalizationMessages).toEqual([
      "take: capped from 500 to 100",
      "skip: safety default 0 applied",
    ]);
    expect(viewModel.inspector.durationLabel).toBe("18.3 ms");
    expect(viewModel.inspector.safetyLimits).toEqual([
      { label: "Args depth", value: "2 / 8" },
      { label: "Timeout", value: "1000 ms" },
      { label: "Response size", value: "1.5 KB / 256 KB" },
    ]);
    expect(viewModel.inspector.warnings).toEqual([
      { code: "NON_UNIQUE_FILTER", path: "where.email", message: "scan risk" },
    ]);
    expect(viewModel.inspector.sqlEvents).toEqual([
      { label: "SQL #1", durationLabel: "7.00 ms", query: "SELECT 1", params: "[]" },
      { label: "SQL #2", durationLabel: "2.00 ms", query: null, params: null },
    ]);
  });

  it("uses API-provided Prisma calls over fallbacks", () => {
    const viewModel = createRowsViewModel({
      preview: preview({
        prismaCall: "prisma.user.findMany({ take: 1 })",
        result: [{ id: "user_1" }],
      }),
    });

    expect(viewModel.inspector.prismaCall).toBe("prisma.user.findMany({ take: 1 })");
  });
});

function createRowsViewModel({
  preview,
  selectedModel = userModel(),
  selectedRowIndex = 0,
}: {
  preview: QueryLabPreviewResponse;
  selectedModel?: Model;
  selectedRowIndex?: number;
}) {
  const viewModel = createQueryLabResultViewModel({
    preview,
    fallbackOperation: "findMany",
    selectedModel,
    selectedRowIndex,
  });
  expect(viewModel.kind).toBe("rows");
  if (viewModel.kind !== "rows") {
    throw new Error(`Expected rows view model, received ${viewModel.kind}`);
  }
  return viewModel;
}

function preview(
  overrides: Partial<QueryLabPreviewResponse> & { operation?: QueryLabOperation } = {},
): QueryLabPreviewResponse {
  return {
    model: "User",
    operation: "findMany",
    args: {},
    result: [{ id: "user_1" }],
    ...overrides,
  };
}

function userModel(fields: Field[] = [field("id", "String"), field("email", "String")]) {
  return {
    name: "User",
    fields,
  };
}

function field(
  name: string,
  type: string,
  kind: Field["kind"] = "scalar",
  isList = false,
  isRequired = true,
): Field {
  return {
    name,
    kind,
    type,
    isList,
    isRequired,
  };
}
