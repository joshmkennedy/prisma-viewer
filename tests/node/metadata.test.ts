import { describe, expect, it } from "vitest";
import { MetadataError, discoverPrismaMetadata } from "../../src/node/metadata";

describe("discoverPrismaMetadata", () => {
  it("discovers model and field metadata from Prisma runtime data model objects", () => {
    const metadata = discoverPrismaMetadata({
      _runtimeDataModel: {
        models: {
          Post: {
            name: "Post",
            fields: [
              field({ name: "id", type: "Int", isId: true, hasDefaultValue: true }),
              field({ name: "title", type: "String" }),
              field({
                name: "author",
                kind: "object",
                type: "User",
                relationName: "PostToUser",
              }),
            ],
          },
          User: {
            name: "User",
            fields: [
              field({ name: "id", type: "String", isId: true }),
              field({ name: "email", type: "String", isUnique: true }),
              field({ name: "posts", kind: "object", type: "Post", isList: true }),
            ],
          },
        },
      },
    });

    expect(metadata).toEqual({
      models: [
        {
          name: "Post",
          fields: [
            {
              name: "id",
              kind: "scalar",
              type: "Int",
              isList: false,
              isRequired: true,
              isUnique: false,
              isId: true,
              hasDefaultValue: true,
              relationName: null,
            },
            {
              name: "title",
              kind: "scalar",
              type: "String",
              isList: false,
              isRequired: true,
              isUnique: false,
              isId: false,
              hasDefaultValue: false,
              relationName: null,
            },
            {
              name: "author",
              kind: "object",
              type: "User",
              isList: false,
              isRequired: true,
              isUnique: false,
              isId: false,
              hasDefaultValue: false,
              relationName: "PostToUser",
            },
          ],
        },
        {
          name: "User",
          fields: [
            {
              name: "id",
              kind: "scalar",
              type: "String",
              isList: false,
              isRequired: true,
              isUnique: false,
              isId: true,
              hasDefaultValue: false,
              relationName: null,
            },
            {
              name: "email",
              kind: "scalar",
              type: "String",
              isList: false,
              isRequired: true,
              isUnique: true,
              isId: false,
              hasDefaultValue: false,
              relationName: null,
            },
            {
              name: "posts",
              kind: "object",
              type: "Post",
              isList: true,
              isRequired: true,
              isUnique: false,
              isId: false,
              hasDefaultValue: false,
              relationName: null,
            },
          ],
        },
      ],
    });
  });

  it("uses runtime data model map keys when generated model objects omit names", () => {
    const metadata = discoverPrismaMetadata({
      _runtimeDataModel: {
        models: {
          User: {
            fields: [
              field({ name: "id", type: "Int", isId: true }),
              field({ name: "email", type: "String", isUnique: true }),
            ],
          },
        },
      },
    });

    expect(metadata.models).toEqual([
      {
        name: "User",
        fields: [
          {
            name: "id",
            kind: "scalar",
            type: "Int",
            isList: false,
            isRequired: true,
            isUnique: false,
            isId: true,
            hasDefaultValue: false,
            relationName: null,
          },
          {
            name: "email",
            kind: "scalar",
            type: "String",
            isList: false,
            isRequired: true,
            isUnique: true,
            isId: false,
            hasDefaultValue: false,
            relationName: null,
          },
        ],
      },
    ]);
  });

  it("discovers model and field metadata from DMMF-compatible arrays", () => {
    const metadata = discoverPrismaMetadata({
      _dmmf: {
        datamodel: {
          models: [
            {
              name: "Session",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "expiresAt", type: "DateTime", isRequired: false }),
              ],
            },
          ],
        },
      },
    });

    expect(metadata.models).toEqual([
      {
        name: "Session",
        fields: [
          {
            name: "id",
            kind: "scalar",
            type: "String",
            isList: false,
            isRequired: true,
            isUnique: false,
            isId: true,
            hasDefaultValue: false,
            relationName: null,
          },
          {
            name: "expiresAt",
            kind: "scalar",
            type: "DateTime",
            isList: false,
            isRequired: false,
            isUnique: false,
            isId: false,
            hasDefaultValue: false,
            relationName: null,
          },
        ],
      },
    ]);
  });

  it("rejects invalid metadata shapes", () => {
    expect(() =>
      discoverPrismaMetadata({
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [{ name: "id", kind: "scalar" }],
            },
          },
        },
      }),
    ).toThrow(MetadataError);

    expect(() => discoverPrismaMetadata({})).toThrow(
      /Could not discover Prisma model metadata/,
    );
  });
});

function field(
  overrides: Partial<{
    name: string;
    kind: "scalar" | "object" | "enum" | "unsupported";
    type: string;
    isList: boolean;
    isRequired: boolean;
    isUnique: boolean;
    isId: boolean;
    hasDefaultValue: boolean;
    relationName: string;
  }>,
) {
  return {
    name: "field",
    kind: "scalar",
    type: "String",
    isList: false,
    isRequired: true,
    isUnique: false,
    isId: false,
    hasDefaultValue: false,
    ...overrides,
  };
}
