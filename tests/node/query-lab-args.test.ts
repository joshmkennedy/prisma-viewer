import { describe, expect, it } from "vitest";
import { parseQueryLabArgsSource } from "../../src/node/query-lab-args";

describe("parseQueryLabArgsSource", () => {
  it("accepts object literal args with safe literal values", () => {
    const result = parseQueryLabArgsSource(`
      {
        where: {
          email: { contains: "example.com" },
          age: { gte: -18 },
          active: true,
          deletedAt: null,
          tags: ["admin", "team"],
          score: +12.5,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 25
      }
    `);

    expect(result).toEqual({
      args: {
        where: {
          email: { contains: "example.com" },
          age: { gte: -18 },
          active: true,
          deletedAt: null,
          tags: ["admin", "team"],
          score: 12.5,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 25,
      },
    });
  });

  it("accepts parenthesized object literal args", () => {
    expect(parseQueryLabArgsSource("({ where: { id: 'user_1' } });")).toEqual({
      args: { where: { id: "user_1" } },
    });
  });

  it("accepts new Date with a single string literal", () => {
    const result = parseQueryLabArgsSource(`
      {
        where: {
          createdAt: { gte: new Date("2026-05-27T12:00:00.000Z") }
        }
      }
    `);

    expect("args" in result ? result.args : result.error).toEqual({
      where: {
        createdAt: {
          gte: new Date("2026-05-27T12:00:00.000Z"),
        },
      },
    });
  });

  it("returns a clear parse error for invalid syntax", () => {
    const result = parseQueryLabArgsSource("{ where: { id: } }");

    expect(result).toMatchObject({ error: expect.stringContaining("invalid syntax") });
  });

  it.each([
    ["variables", "{ where: userWhere }", "Identifier"],
    ["arbitrary function calls", "{ where: makeWhere() }", "CallExpression"],
    ["callbacks", "{ where: { id: (value) => value } }", "ArrowFunction"],
    ["member expressions", "{ where: { id: user.id } }", "PropertyAccessExpression"],
    ["template expressions", "{ where: { email: `admin@${domain}` } }", "TemplateExpression"],
    ["spread properties", "{ ...where }", "explicit property assignments"],
    ["shorthand properties", "{ where }", "explicit property assignments"],
    ["computed property names", "{ [fieldName]: true }", "property names"],
    ["unsupported constructors", "{ where: { id: new String('x') } }", "new Date"],
  ])("rejects unsafe %s", (_label, source, expectedMessage) => {
    const result = parseQueryLabArgsSource(source);

    expect(result).toMatchObject({ error: expect.stringContaining(expectedMessage) });
  });

  it.each([
    ["imports", "import { PrismaClient } from '@prisma/client';\n{}"],
    ["loops", "while (true) {}\n{}"],
    ["multiple expressions", "{}\n{}"],
  ])("rejects statement-level code: %s", (_label, source) => {
    const result = parseQueryLabArgsSource(source);

    expect(result).toHaveProperty("error");
  });
});
