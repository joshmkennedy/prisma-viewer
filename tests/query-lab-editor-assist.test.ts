import { describe, expect, it } from "vitest";
import {
  getQueryLabCompletions,
  getQueryLabEditorDiagnostics,
  getQueryLabTopLevelArgs,
  type QueryLabAssistContext,
} from "../src/query-lab-editor-assist";

describe("Query Lab editor assist", () => {
  it("suggests operation-supported top-level args", () => {
    expect(getQueryLabTopLevelArgs("findMany")).toEqual([
      "where",
      "select",
      "include",
      "orderBy",
      "skip",
      "take",
    ]);
    expect(getQueryLabTopLevelArgs("findFirst")).toEqual([
      "where",
      "select",
      "include",
      "orderBy",
      "skip",
    ]);
    expect(getQueryLabTopLevelArgs("findUnique")).toEqual(["where", "select", "include"]);
    expect(getQueryLabTopLevelArgs("count")).toEqual(["where"]);

    expect(labelsFor("{  }", 2, context({ operation: "count" }))).toEqual(["where"]);
    expect(labelsFor("{ where: {},  }", 13, context({ operation: "findMany" }))).toEqual([
      "select",
      "include",
      "orderBy",
      "skip",
      "take",
    ]);
  });

  it("suggests scalar, enum, and relation fields in query contexts", () => {
    expect(labelsFor("{ where: {  } }", 11)).toEqual([
      "id",
      "email",
      "role",
      "posts",
      "AND",
      "OR",
      "NOT",
    ]);
    expect(labelsFor("{ select: {  } }", 12)).toEqual(["id", "email", "role", "posts"]);
    expect(labelsFor("{ orderBy: {  } }", 13)).toEqual(["id", "email", "role", "posts"]);
  });

  it("suggests relation fields for include contexts", () => {
    expect(labelsFor("{ include: {  } }", 13)).toEqual(["posts"]);
    expect(
      labelsFor("{ include: { posts: { include: {  } } } }", 33),
      "nested include should use the related model metadata",
    ).toEqual(["author"]);
  });

  it("suggests enum values and common Prisma operators where relevant", () => {
    expect(labelsFor("{ where: { email: {  } } }", 20)).toEqual([
      "equals",
      "not",
      "in",
      "notIn",
      "lt",
      "lte",
      "gt",
      "gte",
      "contains",
      "startsWith",
      "endsWith",
    ]);
    expect(labelsFor("{ where: { role:  } }", 17)).toEqual(["ADMIN", "MEMBER"]);
    expect(labelsFor("{ where: { role: { equals:  } } }", 27)).toEqual(["ADMIN", "MEMBER"]);
    expect(labelsFor("{ where: { role: { in: [  ] } } }", 25)).toEqual(["ADMIN", "MEMBER"]);
  });

  it("reports lightweight metadata-backed diagnostics", () => {
    expect(messagesFor("{ cursor: { id: \"1\" } }")).toContain(
      "Unsupported Query Lab findMany arg: cursor.",
    );
    expect(messagesFor("{ where: { missing: \"value\" } }")).toContain(
      "Unknown field where.missing on model User.",
    );
    expect(messagesFor("{ include: { email: true } }")).toContain(
      "include.email must reference a relation field.",
    );
    expect(messagesFor("{ where: { email: { bogus: \"value\" } } }")).toContain(
      "Unsupported field filter where.email.bogus.",
    );
  });

  it("reports parse-shaped bracket diagnostics", () => {
    expect(messagesFor("{ where: { email: \"ada@example.com\" }")).toEqual([
      "Unclosed \"{\" in Args Mode source.",
    ]);
  });
});

function labelsFor(
  source: string,
  cursorOffset: number,
  assistContext: QueryLabAssistContext = context(),
) {
  return getQueryLabCompletions(source, cursorOffset, assistContext).map((item) => item.label);
}

function messagesFor(source: string) {
  return getQueryLabEditorDiagnostics(source, context()).map((item) => item.message);
}

function context(overrides: Partial<QueryLabAssistContext> = {}): QueryLabAssistContext {
  return {
    models: [
      {
        name: "User",
        fields: [
          field("id", "String", "scalar"),
          field("email", "String", "scalar"),
          { ...field("role", "Role", "enum"), enumValues: ["ADMIN", "MEMBER"] },
          field("posts", "Post", "object", true),
        ],
      },
      {
        name: "Post",
        fields: [
          field("id", "String", "scalar"),
          field("title", "String", "scalar"),
          field("author", "User", "object"),
        ],
      },
    ],
    modelName: "User",
    operation: "findMany",
    ...overrides,
  };
}

function field(
  name: string,
  type: string,
  kind: "scalar" | "object" | "enum",
  isList = false,
) {
  return {
    name,
    kind,
    type,
    enumValues: [],
    isList,
    isRequired: true,
  };
}
