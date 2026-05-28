import { describe, expect, it } from "vitest";
import {
  normalizeModelRouteSearch,
  toModelRouteSearchInput,
  validateModelRouteSearch,
} from "../src/features/model-browser/model-route-search";

describe("model route search boundary", () => {
  it("falls back for invalid page and pageSize values", () => {
    expect(normalizeModelRouteSearch({ page: "0", pageSize: "999" })).toMatchObject({
      page: 1,
      pageSize: 100,
    });
    expect(normalizeModelRouteSearch({ page: "abc", pageSize: "-1" })).toMatchObject({
      page: 1,
      pageSize: 100,
    });
  });

  it("accepts only supported page-size options", () => {
    expect(normalizeModelRouteSearch({ pageSize: "25" }).pageSize).toBe(25);
    expect(normalizeModelRouteSearch({ pageSize: 50 }).pageSize).toBe(50);
    expect(normalizeModelRouteSearch({ pageSize: "100" }).pageSize).toBe(100);
    expect(normalizeModelRouteSearch({ pageSize: "10" }).pageSize).toBe(100);
  });

  it("parses filters from URL strings and object input", () => {
    const filters = [
      { field: "email", operator: "contains", value: "ada" },
      { field: "role", operator: "empty" },
    ];

    expect(normalizeModelRouteSearch({ filters: JSON.stringify(filters) }).filters).toEqual([
      {
        id: "url-0-email-contains",
        field: "email",
        operator: "contains",
        value: "ada",
      },
      {
        id: "url-1-role-empty",
        field: "role",
        operator: "empty",
        value: "",
      },
    ]);
    expect(normalizeModelRouteSearch({ filters }).filters).toEqual([
      expect.objectContaining({ field: "email", operator: "contains", value: "ada" }),
      expect.objectContaining({ field: "role", operator: "empty", value: "" }),
    ]);
  });

  it("drops invalid filters safely", () => {
    expect(
      normalizeModelRouteSearch({
        filters: JSON.stringify([
          { field: "email", operator: "contains", value: "ada" },
          { field: "role", operator: "unknown", value: "ADMIN" },
          { field: 123, operator: "equals", value: "x" },
          null,
        ]),
      }).filters,
    ).toEqual([
      expect.objectContaining({ field: "email", operator: "contains", value: "ada" }),
    ]);
    expect(normalizeModelRouteSearch({ filters: "not json" }).filters).toEqual([]);
  });

  it("parses and encodes sorting", () => {
    const normalized = normalizeModelRouteSearch({
      sort: "email:asc,createdAt:desc,bad:sideways,:asc",
    });

    expect(normalized.sort).toEqual([
      { id: "email", desc: false },
      { id: "createdAt", desc: true },
    ]);
    expect(toModelRouteSearchInput(normalized).sort).toBe("email:asc,createdAt:desc");
  });

  it("parses row indexes and clears invalid rows", () => {
    expect(normalizeModelRouteSearch({ row: "0" }).row).toBe(0);
    expect(normalizeModelRouteSearch({ row: 3 }).row).toBe(3);
    expect(normalizeModelRouteSearch({ row: "-1" }).row).toBeNull();
    expect(normalizeModelRouteSearch({ row: "1.5" }).row).toBeNull();
  });

  it("omits default values from encoded search", () => {
    expect(
      toModelRouteSearchInput({
        page: 1,
        pageSize: 100,
        search: "   ",
        filters: [],
        sort: [],
        row: null,
      }),
    ).toEqual({
      page: undefined,
      pageSize: undefined,
      search: undefined,
      filters: undefined,
      sort: undefined,
      row: undefined,
    });
  });

  it("validates to canonical URL search input", () => {
    expect(
      validateModelRouteSearch({
        page: "2",
        pageSize: "25",
        search: "ada",
        filters: JSON.stringify([{ field: "email", operator: "contains", value: "ada" }]),
        sort: "email:desc,bad:sideways",
        row: "4",
      } as Record<string, unknown>),
    ).toEqual({
      page: 2,
      pageSize: 25,
      search: "ada",
      filters: [{ field: "email", operator: "contains", value: "ada" }],
      sort: "email:desc",
      row: 4,
    });
  });
});
