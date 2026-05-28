import { describe, expect, it, vi } from "vitest";
import type { Monaco } from "@monaco-editor/react";
import {
  QUERY_LAB_LANGUAGE_ID,
  QUERY_LAB_MARKER_OWNER,
  QUERY_LAB_THEME_ID,
  disposeQueryLabCompletionProvider,
  monacoCompletionKind,
  registerQueryLabCompletionProvider,
  registerQueryLabLanguage,
  setQueryLabEditorMarkers,
} from "../src/features/query-lab/query-lab-monaco";
import type { QueryLabAssistContext } from "../src/query-lab-editor-assist";

describe("query-lab-monaco", () => {
  it("registers the language idempotently and defines the editor theme", () => {
    const registeredLanguages: Array<{ id: string }> = [];
    const monaco = fakeMonaco({
      getLanguages: () => registeredLanguages,
      register: vi.fn((language: { id: string }) => {
        registeredLanguages.push(language);
      }),
    });

    registerQueryLabLanguage(monaco);
    registerQueryLabLanguage(monaco);

    expect(monaco.languages.register).toHaveBeenCalledTimes(1);
    expect(monaco.languages.register).toHaveBeenCalledWith({ id: QUERY_LAB_LANGUAGE_ID });
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
    expect(monaco.editor.defineTheme).toHaveBeenCalledTimes(2);
    expect(monaco.editor.defineTheme).toHaveBeenLastCalledWith(
      QUERY_LAB_THEME_ID,
      expect.objectContaining({
        colors: expect.objectContaining({
          "editor.background": "#101319",
          "editorGutter.background": "#14181f",
        }),
      }),
    );
  });

  it("maps Query Lab completion kinds to Monaco completion kinds", () => {
    const monaco = fakeMonaco();

    expect(monacoCompletionKind(monaco, "arg")).toBe("Property");
    expect(monacoCompletionKind(monaco, "relation")).toBe("Reference");
    expect(monacoCompletionKind(monaco, "enum")).toBe("EnumMember");
    expect(monacoCompletionKind(monaco, "operator")).toBe("Operator");
    expect(monacoCompletionKind(monaco, "literal")).toBe("Value");
    expect(monacoCompletionKind(monaco, "field")).toBe("Field");
  });

  it("registers a completion provider and disposes it without leaks", () => {
    const dispose = vi.fn();
    const monaco = fakeMonaco({
      registerCompletionItemProvider: vi.fn(() => ({ dispose })),
    });

    const provider = registerQueryLabCompletionProvider(monaco, () => context());
    const registration = vi.mocked(monaco.languages.registerCompletionItemProvider).mock
      .calls[0][1];
    const completions = registration.provideCompletionItems(fakeTextModel("{", 1), {
      lineNumber: 1,
      column: 2,
    });

    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledWith(
      QUERY_LAB_LANGUAGE_ID,
      expect.objectContaining({
        triggerCharacters: [":", "{", ",", "\"", "'"],
      }),
    );
    expect(completions.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "where",
          insertText: "where: ",
          kind: "Property",
          range: {
            startLineNumber: 1,
            endLineNumber: 1,
            startColumn: 2,
            endColumn: 2,
          },
        }),
      ]),
    );

    disposeQueryLabCompletionProvider(provider);
    disposeQueryLabCompletionProvider(null);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("converts editor diagnostics to Monaco markers", () => {
    const monaco = fakeMonaco();
    const model = fakeTextModel('{ cursor: { id: "user_1" } }', 28);
    const editor = { getModel: () => model };

    setQueryLabEditorMarkers(monaco, editor, context(), model.getValue());

    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(
      model,
      QUERY_LAB_MARKER_OWNER,
      expect.arrayContaining([
        expect.objectContaining({
          severity: "Warning",
          message: "Unsupported Query Lab findMany arg: cursor.",
          startLineNumber: 1,
          startColumn: 3,
        }),
      ]),
    );
  });
});

function context(): QueryLabAssistContext {
  return {
    operation: "findMany",
    modelName: "User",
    models: [
      {
        name: "User",
        fields: [
          {
            name: "id",
            kind: "scalar",
            type: "String",
            isList: false,
            isRequired: true,
          },
        ],
      },
    ],
  };
}

function fakeTextModel(source: string, offset: number) {
  return {
    getValue: () => source,
    getOffsetAt: () => offset,
    getWordUntilPosition: (position: { column: number }) => ({
      startColumn: position.column,
      endColumn: position.column,
    }),
    getPositionAt: (nextOffset: number) => ({
      lineNumber: 1,
      column: nextOffset + 1,
    }),
  };
}

function fakeMonaco(overrides: Partial<Monaco["languages"]> = {}) {
  return {
    MarkerSeverity: { Warning: "Warning" },
    languages: {
      CompletionItemKind: {
        Property: "Property",
        Reference: "Reference",
        EnumMember: "EnumMember",
        Operator: "Operator",
        Value: "Value",
        Field: "Field",
      },
      getLanguages: vi.fn(() => []),
      register: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
      ...overrides,
    },
    editor: {
      defineTheme: vi.fn(),
      setModelMarkers: vi.fn(),
    },
  } as unknown as Monaco;
}
