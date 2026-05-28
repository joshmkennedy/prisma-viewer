import type { Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor, languages as MonacoLanguages } from "monaco-editor";
import {
  getQueryLabCompletions,
  getQueryLabEditorDiagnostics,
  type QueryLabAssistContext,
  type QueryLabCompletionKind,
} from "../../query-lab-editor-assist";

export const QUERY_LAB_LANGUAGE_ID = "query-lab-args";
export const QUERY_LAB_THEME_ID = "query-lab-theme";
export const QUERY_LAB_MARKER_OWNER = "query-lab-assist";

const QUERY_LAB_EDITOR_COLORS = {
  foreground: "#e1e7ef",
  surface: "#101319",
  panel: "#14181f",
  elevated: "#1b1f27",
  muted: "#242932",
  mutedForeground: "#959fac",
  border: "#2f3542",
  primary: "#12d9b8",
  accent: "#3191f6",
  code: "#fad242",
  warning: "#fa8d2e",
  danger: "#ea5358",
} as const;

export function monacoCompletionKind(monaco: Monaco, kind: QueryLabCompletionKind) {
  if (kind === "arg") return monaco.languages.CompletionItemKind.Property;
  if (kind === "relation") return monaco.languages.CompletionItemKind.Reference;
  if (kind === "enum") return monaco.languages.CompletionItemKind.EnumMember;
  if (kind === "operator") return monaco.languages.CompletionItemKind.Operator;
  if (kind === "literal") return monaco.languages.CompletionItemKind.Value;
  return monaco.languages.CompletionItemKind.Field;
}

export function setQueryLabEditorMarkers(
  monaco: Monaco,
  editor: MonacoEditor.IStandaloneCodeEditor,
  context: QueryLabAssistContext,
  source: string,
) {
  const model = editor.getModel();
  if (!model) return;
  const markers = getQueryLabEditorDiagnostics(source, context).map((diagnostic) => {
    const start = model.getPositionAt(diagnostic.startOffset);
    const end = model.getPositionAt(Math.max(diagnostic.endOffset, diagnostic.startOffset + 1));
    return {
      severity: monaco.MarkerSeverity.Warning,
      message: diagnostic.message,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    };
  });
  monaco.editor.setModelMarkers(model, QUERY_LAB_MARKER_OWNER, markers);
}

export function registerQueryLabLanguage(monaco: Monaco) {
  if (!isQueryLabLanguageRegistered(monaco)) {
    monaco.languages.register({ id: QUERY_LAB_LANGUAGE_ID });
    monaco.languages.setMonarchTokensProvider(QUERY_LAB_LANGUAGE_ID, {
      tokenizer: {
        root: [
          [/[{}[\]:,]/, "delimiter"],
          [/"([^"\\]|\\.)*$/, "string.invalid"],
          [/"/, { token: "string.quote", next: "@string" }],
          [/'([^'\\]|\\.)*$/, "string.invalid"],
          [/'/, { token: "string.quote", next: "@singleString" }],
          [/\b(true|false|null)\b/, "constant"],
          [/\b\d+(\.\d+)?\b/, "number"],
          [/[A-Za-z_$][\w$]*/, "identifier"],
        ],
        string: [
          [/[^\\"]+/, "string"],
          [/\\./, "string.escape"],
          [/"/, { token: "string.quote", next: "@pop" }],
        ],
        singleString: [
          [/[^\\']+/, "string"],
          [/\\./, "string.escape"],
          [/'/, { token: "string.quote", next: "@pop" }],
        ],
      },
    });
  }

  monaco.editor.defineTheme(QUERY_LAB_THEME_ID, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "delimiter", foreground: QUERY_LAB_EDITOR_COLORS.mutedForeground.slice(1) },
      { token: "identifier", foreground: QUERY_LAB_EDITOR_COLORS.foreground.slice(1) },
      { token: "constant", foreground: QUERY_LAB_EDITOR_COLORS.accent.slice(1) },
      { token: "number", foreground: QUERY_LAB_EDITOR_COLORS.primary.slice(1) },
      { token: "string", foreground: QUERY_LAB_EDITOR_COLORS.code.slice(1) },
      { token: "string.quote", foreground: QUERY_LAB_EDITOR_COLORS.code.slice(1) },
      { token: "string.escape", foreground: QUERY_LAB_EDITOR_COLORS.accent.slice(1) },
      { token: "string.invalid", foreground: QUERY_LAB_EDITOR_COLORS.danger.slice(1) },
    ],
    colors: {
      "editor.background": QUERY_LAB_EDITOR_COLORS.surface,
      "editor.foreground": QUERY_LAB_EDITOR_COLORS.foreground,
      "editorLineNumber.foreground": QUERY_LAB_EDITOR_COLORS.mutedForeground,
      "editorLineNumber.activeForeground": QUERY_LAB_EDITOR_COLORS.primary,
      "editorCursor.foreground": QUERY_LAB_EDITOR_COLORS.primary,
      "editor.selectionBackground": `${QUERY_LAB_EDITOR_COLORS.accent}55`,
      "editor.inactiveSelectionBackground": `${QUERY_LAB_EDITOR_COLORS.accent}33`,
      "editor.lineHighlightBackground": QUERY_LAB_EDITOR_COLORS.panel,
      "editorLineNumber.dimmedForeground": QUERY_LAB_EDITOR_COLORS.muted,
      "editorIndentGuide.background1": QUERY_LAB_EDITOR_COLORS.border,
      "editorIndentGuide.activeBackground1": QUERY_LAB_EDITOR_COLORS.mutedForeground,
      "editorWidget.background": QUERY_LAB_EDITOR_COLORS.elevated,
      "editorWidget.border": QUERY_LAB_EDITOR_COLORS.border,
      "editorSuggestWidget.background": QUERY_LAB_EDITOR_COLORS.elevated,
      "editorSuggestWidget.border": QUERY_LAB_EDITOR_COLORS.border,
      "editorSuggestWidget.foreground": QUERY_LAB_EDITOR_COLORS.foreground,
      "editorSuggestWidget.highlightForeground": QUERY_LAB_EDITOR_COLORS.primary,
      "editorSuggestWidget.selectedBackground": QUERY_LAB_EDITOR_COLORS.muted,
      "editorHoverWidget.background": QUERY_LAB_EDITOR_COLORS.elevated,
      "editorHoverWidget.border": QUERY_LAB_EDITOR_COLORS.border,
      "editorMarkerNavigation.background": QUERY_LAB_EDITOR_COLORS.panel,
      "editorWarning.foreground": QUERY_LAB_EDITOR_COLORS.warning,
      "editorError.foreground": QUERY_LAB_EDITOR_COLORS.danger,
      "editorGutter.background": QUERY_LAB_EDITOR_COLORS.panel,
    },
  });
}

export function registerQueryLabCompletionProvider(
  monaco: Monaco,
  getContext: () => QueryLabAssistContext,
) {
  return monaco.languages.registerCompletionItemProvider(QUERY_LAB_LANGUAGE_ID, {
    triggerCharacters: [":", "{", ",", "\"", "'"],
    provideCompletionItems: (
      model: MonacoEditor.ITextModel,
      position: { lineNumber: number; column: number },
    ) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions = getQueryLabCompletions(
        model.getValue(),
        model.getOffsetAt(position),
        getContext(),
      ).map((item) => ({
        label: item.label,
        insertText: item.insertText,
        kind: monacoCompletionKind(monaco, item.kind),
        detail: item.detail,
        range,
      }));

      return { suggestions };
    },
  });
}

export function disposeQueryLabCompletionProvider(
  provider: { dispose: () => void } | null,
) {
  provider?.dispose();
}

function isQueryLabLanguageRegistered(monaco: Monaco) {
  return monaco.languages
    .getLanguages()
    .some((language: MonacoLanguages.ILanguageExtensionPoint) => {
      return language.id === QUERY_LAB_LANGUAGE_ID;
    });
}
