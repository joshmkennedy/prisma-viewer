import { describe, expect, it } from "vitest";
import { formatQueryLabArgsSource } from "../src/query-lab-args-format";

describe("formatQueryLabArgsSource", () => {
  it("formats Query Lab object literal args", () => {
    expect(
      formatQueryLabArgsSource(
        '{"where":{"email":{"contains":"example.com"},"active":true},"take":25}',
      ),
    ).toEqual({
      source: `{
  where: {
    email: {
      contains: "example.com"
    },
    active: true
  },
  take: 25
}`,
    });
  });

  it("supports arrays, trailing commas, comments, and parenthesized sources", () => {
    expect(
      formatQueryLabArgsSource(`
        ({
          // recent posts first
          orderBy: [{ createdAt: 'desc' }],
          tags: ["admin", "team",],
        });
      `),
    ).toEqual({
      source: `{
  orderBy: [
    {
      createdAt: "desc"
    }
  ],
  tags: ["admin", "team"]
}`,
    });
  });

  it("supports signed numbers, null, and new Date expressions", () => {
    expect(
      formatQueryLabArgsSource(`
        {
          where: {
            createdAt: { gte: new Date("2026-05-27T12:00:00.000Z") },
            deletedAt: null,
            score: +12.5,
            age: -18
          }
        }
      `),
    ).toEqual({
      source: `{
  where: {
    createdAt: {
      gte: new Date("2026-05-27T12:00:00.000Z")
    },
    deletedAt: null,
    score: 12.5,
    age: -18
  }
}`,
    });
  });

  it("quotes property names that cannot be emitted as identifiers", () => {
    expect(formatQueryLabArgsSource('{ "not-an-id": true, 123: "value" }')).toEqual({
      source: `{
  "not-an-id": true,
  "123": "value"
}`,
    });
  });

  it("returns a formatter error for unsupported syntax", () => {
    expect(formatQueryLabArgsSource("{ where: makeWhere() }")).toEqual({
      error: "Args Mode source contains unsupported syntax.",
    });
  });
});
