import type { PreviewMode } from "../record-preview/record-preview-model";
import {
  isQueryLabOperation,
  type QueryLabOperation,
  type QueryLabResultMode,
} from "./query-lab-result-presenter";

export type SavedQueryLabView = {
  id: string;
  name: string;
  model: string;
  operation: QueryLabOperation;
  argsSource: string;
  resultMode: QueryLabResultMode;
  recordPreviewMode: PreviewMode;
  updatedAt: string;
};

export const QUERY_LAB_SAVED_VIEWS_STORAGE_KEY =
  "prisma-pad.query-lab.saved-views.v1";

export type SaveSavedQueryLabViewInput = {
  currentViews: SavedQueryLabView[];
  currentSavedViewId: string | null;
  name: string;
  model: string;
  operation: QueryLabOperation;
  argsSource: string;
  resultMode: QueryLabResultMode;
  recordPreviewMode: PreviewMode;
  now: () => Date;
  createId: () => string;
};

export function loadSavedQueryLabViews(
  storage: Pick<Storage, "getItem"> | null = browserLocalStorage(),
): SavedQueryLabView[] {
  if (!storage) return [];

  try {
    const rawValue = storage.getItem(QUERY_LAB_SAVED_VIEWS_STORAGE_KEY);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeSavedQueryLabView)
      .filter((item): item is SavedQueryLabView => item !== null);
  } catch {
    return [];
  }
}

export function persistSavedQueryLabViews(
  savedViews: SavedQueryLabView[],
  storage: Pick<Storage, "setItem"> | null = browserLocalStorage(),
) {
  if (!storage) return;
  storage.setItem(QUERY_LAB_SAVED_VIEWS_STORAGE_KEY, JSON.stringify(savedViews));
}

export function createSavedQueryLabViewId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `view-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function saveSavedQueryLabView({
  currentViews,
  currentSavedViewId,
  name,
  model,
  operation,
  argsSource,
  resultMode,
  recordPreviewMode,
  now,
  createId,
}: SaveSavedQueryLabViewInput) {
  const trimmedName = name.trim();
  if (!trimmedName) return null;

  const id = currentSavedViewId ?? createId();
  const view: SavedQueryLabView = {
    id,
    name: trimmedName,
    model,
    operation,
    argsSource,
    resultMode,
    recordPreviewMode,
    updatedAt: now().toISOString(),
  };
  const existingIndex = currentViews.findIndex((item) => item.id === id);
  const savedViews =
    existingIndex === -1
      ? [view, ...currentViews]
      : currentViews.map((item) => (item.id === id ? view : item));

  return {
    savedViews,
    currentSavedViewId: id,
    savedViewName: trimmedName,
    view,
  };
}

export function openSavedQueryLabView(view: SavedQueryLabView) {
  return {
    selectedModelName: view.model,
    operation: view.operation,
    argsSource: view.argsSource,
    resultMode: view.resultMode,
    recordPreviewMode: view.recordPreviewMode,
    selectedResultRowIndex: 0,
    savedViewName: view.name,
    currentSavedViewId: view.id,
  };
}

export function renameSavedQueryLabView(
  currentViews: SavedQueryLabView[],
  viewId: string,
  nextName: string,
  now: () => Date,
) {
  const trimmedName = nextName.trim();
  if (!trimmedName) return currentViews;

  return currentViews.map((item) =>
    item.id === viewId
      ? { ...item, name: trimmedName, updatedAt: now().toISOString() }
      : item,
  );
}

export function deleteSavedQueryLabView(
  currentViews: SavedQueryLabView[],
  viewId: string,
  currentSavedViewId: string | null,
) {
  const savedViews = currentViews.filter((item) => item.id !== viewId);
  if (currentSavedViewId !== viewId) {
    return { savedViews, currentSavedViewId, savedViewName: null };
  }

  return { savedViews, currentSavedViewId: null, savedViewName: "" };
}

function normalizeSavedQueryLabView(item: unknown): SavedQueryLabView | null {
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
    resultMode: isQueryLabResultMode(candidate.resultMode) ? candidate.resultMode : "table",
    recordPreviewMode: isPreviewMode(candidate.recordPreviewMode)
      ? candidate.recordPreviewMode
      : "fields",
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date(0).toISOString(),
  };
}

function isQueryLabResultMode(value: unknown): value is QueryLabResultMode {
  return value === "table" || value === "json";
}

function isPreviewMode(value: unknown): value is PreviewMode {
  return value === "fields" || value === "json";
}

function browserLocalStorage() {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}
