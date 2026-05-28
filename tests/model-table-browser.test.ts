import { describe, expect, it } from "vitest";
import {
  createModelRowsRequestUrl,
  createModelTableBrowser,
  normalizeModelRouteSearch,
  operatorsForField,
  validateModelRouteSearch,
  type TableFilter,
} from "../src/model-table-browser";
import type { Field, Model } from "../src/query-lab-result-presenter";

describe("model table browser route state", () => {
  it("degrades invalid route search values to safe canonical state", () => {
    const filters = JSON.stringify([
      { field: "email", operator: "contains", value: "ada" },
      { field: "role", operator: "unknown", value: "ADMIN" },
    ]);

    expect(
      normalizeModelRouteSearch({
        page: "0",
        pageSize: "999",
        search: 123,
        filters,
        sort: "email:asc,bad:sideways",
        row: "-1",
      }),
    ).toMatchObject({
      page: 1,
      pageSize: 100,
      search: "",
      filters: [{ field: "email", operator: "contains", value: "ada" }],
      sort: [{ id: "email", desc: false }],
      row: null,
    });

    expect(
      validateModelRouteSearch({
        page: "2",
        pageSize: "25",
        search: "ada",
        sort: "email:desc",
        row: "3",
      } as Record<string, unknown>),
    ).toEqual({
      page: 2,
      pageSize: 25,
      search: "ada",
      sort: "email:desc",
      row: 3,
    });
  });

  it("prunes metadata-backed filters, sorts, and invalid selected rows", () => {
    const browser = createModelTableBrowser({
      modelName: "User",
      rawSearch: {
        filters: [
          { field: "missing", operator: "equals", value: "x" },
          { field: "email", operator: "contains", value: "ada" },
        ],
        sort: "missing:asc,email:desc",
        row: 5,
      },
      models: [model("User", [field("id"), field("email")])],
      rows: [{ id: "user_1", email: "ada@example.com" }],
      rowStatus: "success",
    });

    expect(browser.tableFilters).toMatchObject([
      { field: "email", operator: "contains", value: "ada" },
    ]);
    expect(browser.sorting).toEqual([{ id: "email", desc: true }]);
    expect(browser.canonicalSearch).toEqual({
      filters: [{ field: "email", operator: "contains", value: "ada" }],
      sort: "email:desc",
    });
  });
});

describe("model table browser filter policy", () => {
  it("exposes operator matrices for string, numeric, enum, and empty filters", () => {
    expect(operatorsForField(field("email")).map((operator) => operator.value)).toEqual([
      "contains",
      "equals",
      "startsWith",
      "endsWith",
      "empty",
      "notEmpty",
    ]);
    expect(operatorsForField(field("age", "Int")).map((operator) => operator.value)).toEqual([
      "equals",
      "empty",
      "notEmpty",
    ]);
    expect(
      operatorsForField(enumField("role", ["ADMIN", "MEMBER"])).map(
        (operator) => operator.value,
      ),
    ).toEqual(["equals", "empty", "notEmpty"]);
  });

  it("creates default filters and resets operators when fields change", () => {
    const browser = createModelTableBrowser({
      modelName: "User",
      rawSearch: {},
      models: [
        model("User", [
          field("id"),
          field("age", "Int"),
          enumField("role", ["ADMIN", "MEMBER"]),
        ]),
      ],
      rows: [],
      rowStatus: "success",
    });

    expect(browser.commands.addFilter()).toMatchObject({
      filters: [{ field: "id", operator: "contains", value: "" }],
    });

    const stringFilter: TableFilter = {
      id: "filter-1",
      field: "id",
      operator: "startsWith",
      value: "u",
    };
    const withFilter = createModelTableBrowser({
      modelName: "User",
      rawSearch: { filters: [stringFilter] },
      models: browserInputModels(),
      rows: [],
      rowStatus: "success",
    });

    const filterId = withFilter.tableFilters[0].id;

    expect(withFilter.commands.updateFilterField(filterId, "age")).toMatchObject({
      filters: [{ field: "age", operator: "equals", value: "u" }],
    });
    expect(withFilter.commands.updateFilterField(filterId, "role")).toMatchObject({
      filters: [{ field: "role", operator: "equals", value: "ADMIN" }],
    });
  });
});

describe("model table browser row requests and visibility", () => {
  it("builds stable request descriptors and URLs from search, filters, sorting, and pagination", () => {
    const browser = createModelTableBrowser({
      modelName: "User",
      rawSearch: {
        page: 2,
        pageSize: 25,
        search: "ada",
        filters: [{ field: "role", operator: "equals", value: "ADMIN" }],
        sort: "email:asc",
      },
      models: [model("User", [field("email"), enumField("role", ["ADMIN"])])],
      rows: [],
      rowStatus: "loading",
    });

    expect(browser.request).toEqual({
      modelName: "User",
      page: 2,
      pageSize: 25,
      search: "ada",
      filters: [
        expect.objectContaining({ field: "role", operator: "equals", value: "ADMIN" }),
      ],
      sorting: [{ id: "email", desc: false }],
    });
    expect(createModelRowsRequestUrl(browser.request!)).toContain(
      "/api/models/User/rows?page=2&pageSize=25&search=ada",
    );
    expect(decodeURIComponent(createModelRowsRequestUrl(browser.request!))).toContain(
      '"field":"role"',
    );
    expect(decodeURIComponent(createModelRowsRequestUrl(browser.request!))).toContain(
      '"direction":"asc"',
    );
  });

  it("preserves loaded rows while pending refinements are waiting for debounce", () => {
    const browser = createModelTableBrowser({
      modelName: "User",
      rawSearch: { search: "grace" },
      models: [model("User", [field("email")])],
      rows: [
        { email: "ada@example.com" },
        { email: "grace@example.com" },
      ],
      rowStatus: "loading",
      loadedRefinements: { search: "", filters: [] },
    });

    expect(browser.pendingRefinements.search).toBe("grace");
    expect(browser.visibleRows.map(({ row }) => row.email)).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
    expect(browser.summary).toBe("Loading rows, 1 column shown");
  });

  it("maps selected route rows to original row indexes and clears hidden selections", () => {
    const browser = createModelTableBrowser({
      modelName: "User",
      rawSearch: { row: 0, search: "grace" },
      models: [model("User", [field("email")])],
      rows: [
        { email: "ada@example.com" },
        { email: "grace@example.com" },
      ],
      rowStatus: "success",
      loadedRefinements: { search: "grace", filters: [] },
    });

    expect(browser.visibleRows).toEqual([
      { row: { email: "grace@example.com" }, rowIndex: 1 },
    ]);
    expect(browser.selectedRow).toEqual({ email: "ada@example.com" });
    expect(browser.canonicalSearch).toEqual({ search: "grace" });
    expect(browser.commands.selectRow(1)).toEqual({ search: "grace", row: 1 });
  });
});

function browserInputModels() {
  return [
    model("User", [field("id"), field("age", "Int"), enumField("role", ["ADMIN", "MEMBER"])]),
  ];
}

function model(name: string, fields: Field[]): Model {
  return { name, fields };
}

function field(name: string, type = "String", kind: Field["kind"] = "scalar"): Field {
  return {
    name,
    kind,
    type,
    isList: false,
    isRequired: true,
  };
}

function enumField(name: string, enumValues: string[], isList = false): Field {
  return {
    ...field(name, name, "enum"),
    enumValues,
    isList,
  };
}
