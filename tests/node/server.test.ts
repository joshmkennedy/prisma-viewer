import { describe, expect, it } from "vitest";
import { createPrismaApiMiddleware } from "../../src/node/api";
import { startViewerServer } from "../../src/node/server";
import type { StartupContext } from "../../src/node/startup";

describe("startViewerServer", () => {
  it("starts Vite and returns the local URL", async () => {
    const calls: unknown[] = [];
    const middlewareHandlers: unknown[] = [];
    const prismaEvents: string[] = [];
    const fakeServer = {
      httpServer: {
        address: () => ({ port: 5678 }),
      },
      middlewares: {
        use: (handler: unknown) => {
          middlewareHandlers.push(handler);
        },
      },
      listen: async () => undefined,
      close: async () => {
        prismaEvents.push("server-close");
      },
    };

    const result = await startViewerServer(makeContext(), {
      host: "localhost",
      port: 5678,
      viewerRoot: "/viewer",
      createServerImpl: (async (config: unknown) => {
        calls.push(config);
        const plugins = (config as { plugins?: { configureServer?: (server: unknown) => void }[] })
          .plugins;
        plugins?.forEach((plugin) => plugin.configureServer?.(fakeServer));
        return fakeServer;
      }) as never,
      createPrismaRuntimeImpl: async () => ({
        client: {},
        disconnect: async () => {
          prismaEvents.push("prisma-disconnect");
        },
      }),
    });

    expect(result.url).toBe("http://localhost:5678/");
    expect(result.server).toBe(fakeServer);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      root: "/viewer",
      server: { host: "localhost", port: 5678 },
    });
    expect(middlewareHandlers).toHaveLength(1);

    await result.server.close();

    expect(prismaEvents).toEqual(["prisma-disconnect", "server-close"]);
  });

  it("disconnects the Prisma Client when Vite startup fails", async () => {
    const prismaEvents: string[] = [];

    await expect(
      startViewerServer(makeContext(), {
        viewerRoot: "/viewer",
        createServerImpl: (async () => {
          throw new Error("vite failed");
        }) as never,
        createPrismaRuntimeImpl: async () => ({
          client: {},
          disconnect: async () => {
            prismaEvents.push("prisma-disconnect");
          },
        }),
      }),
    ).rejects.toThrow(/vite failed/);

    expect(prismaEvents).toEqual(["prisma-disconnect"]);
  });
});

describe("createPrismaApiMiddleware", () => {
  it("returns discovered models and fields from GET /api/models", async () => {
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
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
                  hasDefaultValue: true,
                },
              ],
            },
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddleware(middleware, { method: "GET", url: "/api/models" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(response.body)).toEqual({
      models: [
        {
          name: "User",
          fields: [
            {
              name: "id",
              kind: "scalar",
              type: "String",
              enumValues: [],
              isList: false,
              isRequired: true,
              isUnique: false,
              isId: true,
              hasDefaultValue: true,
              relationName: null,
            },
          ],
        },
      ],
    });
  });

  it("rejects writes to the metadata endpoint", async () => {
    const middleware = createPrismaApiMiddleware({
      client: {},
      disconnect: async () => undefined,
    });

    const response = await runMiddleware(middleware, { method: "POST", url: "/api/models" });

    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe("GET");
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Prisma Viewer exposes only read-only API endpoints.",
      },
    });
  });

  it("returns a clear API error when metadata lookup fails", async () => {
    const middleware = createPrismaApiMiddleware({
      client: {},
      disconnect: async () => undefined,
    });

    const response = await runMiddleware(middleware, { method: "GET", url: "/api/models" });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "METADATA_UNAVAILABLE",
        message: "Could not discover Prisma model metadata from the generated Prisma Client.",
      },
    });
  });

  it("passes through unrelated routes", () => {
    const middleware = createPrismaApiMiddleware({
      client: {},
      disconnect: async () => undefined,
    });
    let nextCalled = false;

    middleware(
      { method: "GET", url: "/assets/app.js" } as never,
      makeResponse() as never,
      () => {
        nextCalled = true;
      },
    );

    expect(nextCalled).toBe(true);
  });

  it("lists rows for a validated model with bounded default pagination", async () => {
    const calls: unknown[] = [];
    const client = {
      _runtimeDataModel: {
        models: {
          User: {
            name: "User",
            fields: [
              field({ name: "id", type: "String", isId: true }),
              field({ name: "email", type: "String" }),
              field({ name: "posts", kind: "object", type: "Post", isList: true }),
            ],
          },
        },
      },
      user: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [{ id: "user_1", email: "user@example.com" }];
        },
        create: async () => {
          throw new Error("create should not be exposed");
        },
        update: async () => {
          throw new Error("update should not be exposed");
        },
        delete: async () => {
          throw new Error("delete should not be exposed");
        },
      },
      $transaction: async () => {
        throw new Error("transactions should not be exposed");
      },
      $queryRaw: async () => {
        throw new Error("raw SQL should not be exposed");
      },
    };
    const middleware = createPrismaApiMiddleware({
      client,
      disconnect: async () => undefined,
    });

    const response = await runMiddleware(middleware, {
      method: "GET",
      url: "/api/models/User/rows",
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      {
        skip: 0,
        take: 50,
        select: { id: true, email: true },
      },
    ]);
    expect(JSON.parse(response.body)).toEqual({
      model: "User",
      rows: [{ id: "user_1", email: "user@example.com" }],
      pagination: { page: 1, pageSize: 50 },
    });
  });

  it("applies explicit pagination within the configured bound", async () => {
    const calls: unknown[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            Post: {
              name: "Post",
              fields: [field({ name: "id", type: "Int", isId: true })],
            },
          },
        },
        post: {
          findMany: async (args: unknown) => {
            calls.push(args);
            return [];
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddleware(middleware, {
      method: "GET",
      url: "/api/models/Post/rows?page=3&pageSize=25",
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      {
        skip: 50,
        take: 25,
        select: { id: true },
      },
    ]);
    expect(JSON.parse(response.body)).toMatchObject({
      rows: [],
      pagination: { page: 3, pageSize: 25 },
    });
  });

  it("applies validated sorting to row queries", async () => {
    const calls: unknown[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "email", type: "String" }),
                field({ name: "posts", kind: "object", type: "Post", isList: true }),
              ],
            },
          },
        },
        user: {
          findMany: async (args: unknown) => {
            calls.push(args);
            return [{ id: "user_1", email: "ada@example.com" }];
          },
        },
      },
      disconnect: async () => undefined,
    });
    const searchParams = new URLSearchParams({
      sort: JSON.stringify([{ field: "email", direction: "desc" }]),
    });

    const response = await runMiddleware(middleware, {
      method: "GET",
      url: `/api/models/User/rows?${searchParams.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      {
        skip: 0,
        take: 50,
        select: { id: true, email: true },
        orderBy: [{ email: "desc" }],
      },
    ]);
  });

  it("applies read-only search and filter criteria to row queries", async () => {
    const calls: unknown[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "email", type: "String" }),
                field({ name: "age", type: "Int" }),
              ],
            },
          },
        },
        user: {
          findMany: async (args: unknown) => {
            calls.push(args);
            return [{ id: "user_1", email: "ada@example.com", age: 37 }];
          },
        },
      },
      disconnect: async () => undefined,
    });
    const searchParams = new URLSearchParams({
      search: "ada",
      filters: JSON.stringify([
        { field: "email", operator: "endsWith", value: "example.com" },
        { field: "age", operator: "equals", value: "37" },
      ]),
    });

    const response = await runMiddleware(middleware, {
      method: "GET",
      url: `/api/models/User/rows?${searchParams.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      {
        skip: 0,
        take: 50,
        select: { id: true, email: true, age: true },
        where: {
          AND: [
            {
              OR: [
                { id: { contains: "ada" } },
                { email: { contains: "ada" } },
              ],
            },
            { email: { endsWith: "example.com" } },
            { age: 37 },
          ],
        },
      },
    ]);
    expect(JSON.parse(response.body)).toMatchObject({
      rows: [{ id: "user_1", email: "ada@example.com", age: 37 }],
      pagination: { filtersApplied: true },
    });
  });

  it("uses Prisma enum values when applying enum filters", async () => {
    const calls: unknown[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "role", kind: "enum", type: "Role" }),
              ],
            },
          },
          enums: {
            Role: {
              values: ["ADMIN", "MEMBER"],
            },
          },
        },
        user: {
          findMany: async (args: unknown) => {
            calls.push(args);
            return [{ id: "user_1", role: "ADMIN" }];
          },
        },
      },
      disconnect: async () => undefined,
    });
    const searchParams = new URLSearchParams({
      filters: JSON.stringify([{ field: "role", operator: "equals", value: "ADMIN" }]),
    });

    const response = await runMiddleware(middleware, {
      method: "GET",
      url: `/api/models/User/rows?${searchParams.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      {
        skip: 0,
        take: 50,
        select: { id: true, role: true },
        where: { role: "ADMIN" },
      },
    ]);
  });

  it("rejects enum filters that are not actual Prisma enum values", async () => {
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "role", kind: "enum", type: "Role" }),
              ],
            },
          },
          enums: {
            Role: {
              values: ["ADMIN", "MEMBER"],
            },
          },
        },
        user: {
          findMany: async () => {
            throw new Error("should not query");
          },
        },
      },
      disconnect: async () => undefined,
    });
    const searchParams = new URLSearchParams({
      filters: JSON.stringify([{ field: "role", operator: "equals", value: "admin" }]),
    });

    const response = await runMiddleware(middleware, {
      method: "GET",
      url: `/api/models/User/rows?${searchParams.toString()}`,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: {
        code: "INVALID_FILTER",
        message: "Invalid value for role: expected one of ADMIN, MEMBER.",
      },
    });
  });

  it("rejects unknown models before reaching Prisma delegates", async () => {
    const delegateCalls: string[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [field({ name: "id", type: "String", isId: true })],
            },
          },
        },
        post: {
          findMany: async () => {
            delegateCalls.push("post.findMany");
            return [];
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddleware(middleware, {
      method: "GET",
      url: "/api/models/Post/rows",
    });

    expect(response.statusCode).toBe(404);
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "MODEL_NOT_FOUND",
        message: "Unknown Prisma model: Post.",
      },
    });
  });

  it("rejects unbounded or invalid pagination before querying rows", async () => {
    const delegateCalls: string[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [field({ name: "id", type: "String", isId: true })],
            },
          },
        },
        user: {
          findMany: async () => {
            delegateCalls.push("user.findMany");
            return [];
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddleware(middleware, {
      method: "GET",
      url: "/api/models/User/rows?pageSize=1000",
    });

    expect(response.statusCode).toBe(400);
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "INVALID_PAGINATION",
        message:
          "The pageSize query parameter must be a positive integer no greater than 100.",
      },
    });
  });

  it("returns a clear error when Prisma cannot list rows", async () => {
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [field({ name: "id", type: "String", isId: true })],
            },
          },
        },
        user: {
          findMany: async () => {
            throw new Error("database unavailable");
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddleware(middleware, {
      method: "GET",
      url: "/api/models/User/rows",
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "ROWS_UNAVAILABLE",
        message: "Could not list rows for model User: database unavailable",
      },
    });
  });

  it("rejects writes to row endpoints before reaching Prisma delegates", async () => {
    const delegateCalls: string[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [field({ name: "id", type: "String", isId: true })],
            },
          },
        },
        user: {
          findMany: async () => {
            delegateCalls.push("user.findMany");
            return [];
          },
          create: async () => {
            delegateCalls.push("user.create");
            return {};
          },
          update: async () => {
            delegateCalls.push("user.update");
            return {};
          },
          delete: async () => {
            delegateCalls.push("user.delete");
            return {};
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddleware(middleware, {
      method: "DELETE",
      url: "/api/models/User/rows",
    });

    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe("GET");
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Prisma Viewer exposes only read-only API endpoints.",
      },
    });
  });
});

function makeContext(): StartupContext {
  return {
    appRoot: "/target-app",
    databaseUrl: "file:./dev.db",
    loadedEnvFiles: ["/target-app/.env.local"],
    prismaPackagePath: "/target-app/node_modules/prisma/package.json",
    prismaClientPath: "/target-app/node_modules/@prisma/client/index.js",
  };
}

function runMiddleware(
  middleware: ReturnType<typeof createPrismaApiMiddleware>,
  request: { method: string; url: string },
) {
  const response = makeResponse();
  return Promise.resolve(middleware(request as never, response as never, () => undefined)).then(
    () => response,
  );
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string | number | readonly string[]>,
    body: "",
    setHeader(name: string, value: string | number | readonly string[]) {
      this.headers[name] = value;
    },
    end(body: string) {
      this.body = body;
    },
  };
}

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
