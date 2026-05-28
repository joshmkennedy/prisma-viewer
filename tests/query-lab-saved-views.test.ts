import { describe, expect, it, vi } from "vitest";
import {
  QUERY_LAB_SAVED_VIEWS_STORAGE_KEY,
  deleteSavedQueryLabView,
  loadSavedQueryLabViews,
  openSavedQueryLabView,
  persistSavedQueryLabViews,
  renameSavedQueryLabView,
  saveSavedQueryLabView,
  type SavedQueryLabView,
} from "../src/features/query-lab/query-lab-saved-views";

describe("query-lab-saved-views", () => {
  it("loads empty and malformed storage as no saved views", () => {
    expect(loadSavedQueryLabViews(storage(null))).toEqual([]);
    expect(loadSavedQueryLabViews(storage("not json"))).toEqual([]);
    expect(loadSavedQueryLabViews(storage(JSON.stringify({ id: "view_1" })))).toEqual([]);
    expect(
      loadSavedQueryLabViews(
        storage(JSON.stringify([{ id: "view_1" }, null, { name: "Missing id" }])),
      ),
    ).toEqual([]);
  });

  it("loads valid storage and fills missing optional display defaults", () => {
    expect(
      loadSavedQueryLabViews(
        storage(
          JSON.stringify([
            {
              id: "view_1",
              name: "  ",
              model: "User",
              operation: "findMany",
              argsSource: "{}",
            },
            {
              id: "view_2",
              name: "Post JSON",
              model: "Post",
              operation: "findFirst",
              argsSource: "{ where: { id: \"post_1\" } }",
              resultMode: "json",
              recordPreviewMode: "json",
              updatedAt: "2026-05-28T05:00:00.000Z",
            },
          ]),
        ),
      ),
    ).toEqual([
      {
        id: "view_1",
        name: "Untitled view",
        model: "User",
        operation: "findMany",
        argsSource: "{}",
        resultMode: "table",
        recordPreviewMode: "fields",
        updatedAt: "1970-01-01T00:00:00.000Z",
      },
      {
        id: "view_2",
        name: "Post JSON",
        model: "Post",
        operation: "findFirst",
        argsSource: '{ where: { id: "post_1" } }',
        resultMode: "json",
        recordPreviewMode: "json",
        updatedAt: "2026-05-28T05:00:00.000Z",
      },
    ]);
  });

  it("persists saved views to storage", () => {
    const setItem = vi.fn();
    persistSavedQueryLabViews([view({ id: "view_1" })], { setItem });

    expect(setItem).toHaveBeenCalledWith(
      QUERY_LAB_SAVED_VIEWS_STORAGE_KEY,
      JSON.stringify([view({ id: "view_1" })]),
    );
  });

  it("saves new views with injected IDs and timestamps", () => {
    const result = saveSavedQueryLabView({
      currentViews: [view({ id: "existing" })],
      currentSavedViewId: null,
      name: "  User lookup  ",
      model: "User",
      operation: "findUnique",
      argsSource: "{ where: { id: \"user_1\" } }",
      resultMode: "json",
      recordPreviewMode: "json",
      now,
      createId: () => "generated_id",
    });

    expect(result).toMatchObject({
      currentSavedViewId: "generated_id",
      savedViewName: "User lookup",
    });
    expect(result?.savedViews).toEqual([
      view({
        id: "generated_id",
        name: "User lookup",
        model: "User",
        operation: "findUnique",
        argsSource: '{ where: { id: "user_1" } }',
        resultMode: "json",
        recordPreviewMode: "json",
      }),
      view({ id: "existing" }),
    ]);
  });

  it("updates existing saved views", () => {
    const result = saveSavedQueryLabView({
      currentViews: [view({ id: "view_1", name: "Old name" })],
      currentSavedViewId: "view_1",
      name: "New name",
      model: "Post",
      operation: "findFirst",
      argsSource: "{ take: 1 }",
      resultMode: "table",
      recordPreviewMode: "fields",
      now,
      createId: () => "unused",
    });

    expect(result?.savedViews).toEqual([
      view({
        id: "view_1",
        name: "New name",
        model: "Post",
        operation: "findFirst",
        argsSource: "{ take: 1 }",
      }),
    ]);
  });

  it("opens, renames, and deletes saved views", () => {
    const savedView = view({
      id: "view_1",
      name: "Saved lookup",
      model: "Post",
      operation: "findFirst",
      argsSource: "{ where: { id: \"post_1\" } }",
      resultMode: "json",
      recordPreviewMode: "json",
    });

    expect(openSavedQueryLabView(savedView)).toEqual({
      selectedModelName: "Post",
      operation: "findFirst",
      argsSource: '{ where: { id: "post_1" } }',
      resultMode: "json",
      recordPreviewMode: "json",
      selectedResultRowIndex: 0,
      savedViewName: "Saved lookup",
      currentSavedViewId: "view_1",
    });

    expect(renameSavedQueryLabView([savedView], "view_1", "Renamed", now)).toEqual([
      view({ ...savedView, name: "Renamed" }),
    ]);
    expect(deleteSavedQueryLabView([savedView, view({ id: "view_2" })], "view_2", "view_1")).toEqual({
      savedViews: [savedView],
      currentSavedViewId: "view_1",
      savedViewName: null,
    });
    expect(deleteSavedQueryLabView([savedView], "view_1", "view_1")).toEqual({
      savedViews: [],
      currentSavedViewId: null,
      savedViewName: "",
    });
  });
});

function storage(value: string | null) {
  return { getItem: vi.fn(() => value) };
}

function now() {
  return new Date("2026-05-28T05:00:00.000Z");
}

function view(overrides: Partial<SavedQueryLabView> = {}): SavedQueryLabView {
  return {
    id: "view_1",
    name: "Saved view",
    model: "User",
    operation: "findMany",
    argsSource: "{}",
    resultMode: "table",
    recordPreviewMode: "fields",
    updatedAt: "2026-05-28T05:00:00.000Z",
    ...overrides,
  };
}
