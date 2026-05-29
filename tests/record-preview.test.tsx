// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordPreview } from "../src/features/record-preview/RecordPreview";
import {
  fieldsForRecord,
  formatRecordPreviewJson,
  type PreviewMode,
} from "../src/features/record-preview/record-preview-model";
import type { Field, Model } from "../src/domain/prisma-metadata";

afterEach(() => {
  cleanup();
});

describe("record preview model", () => {
  it("uses metadata fields when available and infers missing record fields", () => {
    const model: Model = {
      name: "User",
      fields: [
        field("id", "String"),
        field("email", "String"),
        field("roles", "Role", "enum", true),
      ],
    };

    expect(
      fieldsForRecord(
        {
          id: "user_1",
          email: "ada@example.com",
          roles: ["ADMIN"],
          profile: { timezone: "UTC" },
          loginCount: 12,
          active: true,
          notes: null,
        },
        model,
      ),
    ).toEqual([
      field("id", "String"),
      field("email", "String"),
      field("roles", "Role", "enum", true),
      field("profile", "Json"),
      field("loginCount", "Number"),
      field("active", "Boolean"),
      field("notes", "Unknown", "scalar", false, false),
    ]);
  });

  it("formats record JSON with stable object key ordering", () => {
    expect(
      formatRecordPreviewJson({
        zebra: "last",
        alpha: {
          beta: 2,
          apple: 1,
        },
      }),
    ).toBe('{\n  "alpha": {\n    "apple": 1,\n    "beta": 2\n  },\n  "zebra": "last"\n}');
  });
});

describe("RecordPreview", () => {
  it("renders the supplied empty message when no record is selected", () => {
    renderPreview({ record: null, fields: [] });

    expect(screen.getByText("Select a row.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fields" })).toBeNull();
  });

  it("renders field names, types, nulls, JSON/list values, and long strings", () => {
    const longToken = "token.".repeat(30);
    renderPreview({
      record: {
        id: "log_1",
        payload: { role: "admin", flags: ["beta"] },
        posts: [{ id: "post_1", title: "Nested result" }],
        description: longToken,
        notes: null,
      },
      fields: [
        field("id", "String"),
        field("payload", "Json"),
        field("posts", "Json", "scalar", true),
        field("description", "String"),
        field("notes", "String", "scalar", false, false),
      ],
    });

    const preview = screen.getByText("payload").closest("dl");

    expect(preview).toBeTruthy();
    expect(within(preview as HTMLElement).getByText("payload")).toBeTruthy();
    expect(within(preview as HTMLElement).getByText("Json")).toBeTruthy();
    expect(within(preview as HTMLElement).getByText('{"role":"admin","flags":["beta"]}')).toBeTruthy();
    expect(
      within(preview as HTMLElement).getByText('[{"id":"post_1","title":"Nested result"}]'),
    ).toBeTruthy();
    expect(within(preview as HTMLElement).getByText(longToken)).toBeTruthy();
    expect(within(preview as HTMLElement).getByText("NULL")).toBeTruthy();
  });

  it("switches to stable sorted JSON mode", async () => {
    const onPreviewModeChange = vi.fn();
    renderPreview({
      record: {
        zebra: "last",
        alpha: { beta: 2, apple: 1 },
      },
      fields: [field("zebra", "String"), field("alpha", "Json")],
      previewMode: "json",
      onPreviewModeChange,
    });

    const jsonPreview = screen.getByLabelText("Selected record JSON preview");
    expect(jsonPreview.textContent).toBe(
      '{\n  "alpha": {\n    "apple": 1,\n    "beta": 2\n  },\n  "zebra": "last"\n}',
    );
    expect(screen.getByRole("button", { name: "Copy selected record JSON" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Fields" }));

    expect(onPreviewModeChange).toHaveBeenCalledWith("fields");
  });
});

function renderPreview({
  record,
  fields,
  previewMode = "fields",
  onPreviewModeChange = vi.fn(),
}: {
  record: Record<string, unknown> | null;
  fields: Field[];
  previewMode?: PreviewMode;
  onPreviewModeChange?: (value: string) => void;
}) {
  render(
    <RecordPreview
      record={record}
      fields={fields}
      previewMode={previewMode}
      onPreviewModeChange={onPreviewModeChange}
      emptyMessage="Select a row."
    />,
  );
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
