import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrismaApiMiddleware } from "../../src/node/api";
import { startViewerServer } from "../../src/node/server";
import type { StartupContext } from "../../src/node/startup";

afterEach(() => {
  vi.useRealTimers();
});

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
        message: "Prisma Pad exposes only read-only API endpoints.",
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
      query: {
        model: "User",
        delegateName: "user",
        operation: "findMany",
        args: {
          select: { id: true, email: true },
          skip: 0,
          take: 50,
        },
        select: { id: true, email: true },
        skip: 0,
        take: 50,
        prismaCall:
          "prisma.user.findMany({\n  select: {\n    id: true,\n    email: true\n  },\n  skip: 0,\n  take: 50\n})",
        contributors: [
          {
            source: "select",
            label: "Visible scalar and enum fields contributed to select",
            path: "select",
          },
          {
            source: "page",
            label: "Page 1 contributed skip: 0",
            path: "skip",
          },
          {
            source: "pageSize",
            label: "Rows per page 50 contributed take: 50",
            path: "take",
          },
        ],
      },
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
      query: {
        args: {
          select: { id: true },
          skip: 50,
          take: 25,
        },
        skip: 50,
        take: 25,
        contributors: expect.arrayContaining([
          {
            source: "page",
            label: "Page 3 contributed skip: 50",
            path: "skip",
          },
          {
            source: "pageSize",
            label: "Rows per page 25 contributed take: 25",
            path: "take",
          },
        ]),
      },
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
    expect(JSON.parse(response.body).query).toMatchObject({
      model: "User",
      delegateName: "user",
      operation: "findMany",
      args: {
        orderBy: [{ email: "desc" }],
        select: { id: true, email: true },
        skip: 0,
        take: 50,
      },
      orderBy: [{ email: "desc" }],
      contributors: expect.arrayContaining([
        {
          source: "sort",
          label: "email desc sort contributed to orderBy",
          path: "orderBy",
        },
      ]),
    });
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
      query: {
        model: "User",
        delegateName: "user",
        operation: "findMany",
        args: {
          select: { id: true, email: true, age: true },
          skip: 0,
          take: 50,
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
        contributors: expect.arrayContaining([
          {
            source: "search",
            label: 'Search "ada" contributed to where',
            path: "where",
          },
          {
            source: "filter",
            label: "email filter contributed to where",
            path: "where",
          },
          {
            source: "filter",
            label: "age filter contributed to where",
            path: "where",
          },
        ]),
      },
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

  it("uses Prisma list filters when applying enum list filters", async () => {
    const calls: unknown[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            AdminProfile: {
              name: "AdminProfile",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "roles", kind: "enum", type: "AdminRole", isList: true }),
              ],
            },
          },
          enums: {
            AdminRole: {
              values: ["SYSTEM_ADMIN", "SUPPORT_ADMIN"],
            },
          },
        },
        adminProfile: {
          findMany: async (args: unknown) => {
            calls.push(args);
            return [{ id: "admin_profile_1", roles: ["SYSTEM_ADMIN"] }];
          },
        },
      },
      disconnect: async () => undefined,
    });
    const searchParams = new URLSearchParams({
      filters: JSON.stringify([
        { field: "roles", operator: "equals", value: "SYSTEM_ADMIN" },
      ]),
    });

    const response = await runMiddleware(middleware, {
      method: "GET",
      url: `/api/models/AdminProfile/rows?${searchParams.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      {
        skip: 0,
        take: 50,
        select: { id: true, roles: true },
        where: { roles: { has: "SYSTEM_ADMIN" } },
      },
    ]);
  });

  it("uses Prisma empty list filters for list fields", async () => {
    const calls: unknown[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            AdminProfile: {
              name: "AdminProfile",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "roles", kind: "enum", type: "AdminRole", isList: true }),
              ],
            },
          },
          enums: {
            AdminRole: {
              values: ["SYSTEM_ADMIN", "SUPPORT_ADMIN"],
            },
          },
        },
        adminProfile: {
          findMany: async (args: unknown) => {
            calls.push(args);
            return [];
          },
        },
      },
      disconnect: async () => undefined,
    });
    const searchParams = new URLSearchParams({
      filters: JSON.stringify([{ field: "roles", operator: "notEmpty" }]),
    });

    const response = await runMiddleware(middleware, {
      method: "GET",
      url: `/api/models/AdminProfile/rows?${searchParams.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      {
        skip: 0,
        take: 50,
        select: { id: true, roles: true },
        where: { roles: { isEmpty: false } },
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
        message: "Prisma Pad exposes only read-only API endpoints.",
      },
    });
  });

  it("runs Query Lab findMany through the validated model delegate with a default cap", async () => {
    const calls: unknown[] = [];
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
          findMany: async (args: unknown) => {
            calls.push(args);
            return [{ id: "user_1" }];
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource: "{ where: { id: 'user_1' } }",
      },
    );

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([{ where: { id: "user_1" }, take: 25 }]);
    expect(JSON.parse(response.body)).toEqual({
      model: "User",
      operation: "findMany",
      args: { where: { id: "user_1" }, take: 25 },
      normalizedArgs: { where: { id: "user_1" }, take: 25 },
      normalization: [
        {
          path: "take",
          action: "default",
          reason: "findManySafetyTake",
          value: 25,
        },
      ],
      warnings: [
        {
          code: "FIND_MANY_DEFAULT_TAKE",
          path: "take",
          message:
            "findMany did not include an explicit take, so Query Lab applied the default preview cap.",
        },
      ],
      safetyLimits: {
        maxArgsDepth: 8,
        timeoutMs: 5000,
        maxResponseBytes: 262144,
        argsDepth: 2,
        responseSizeBytes: expect.any(Number),
      },
      prismaCall:
        'prisma.user.findMany({\n  where: {\n    id: "user_1"\n  },\n  take: 25\n})',
      timing: {
        durationMs: expect.any(Number),
      },
      sql: {
        events: [],
      },
      result: [{ id: "user_1" }],
      rows: [{ id: "user_1" }],
    });
    expect(JSON.parse(response.body).timing.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns Query Lab timing and mocked Prisma query event data", async () => {
    let queryHandler: ((event: unknown) => void) | undefined;
    const prismaEvents: string[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        $on: (event: "query", handler: (event: unknown) => void) => {
          prismaEvents.push(event);
          queryHandler = handler;
        },
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
            queryHandler?.({
              query: 'SELECT "User"."id" FROM "User" WHERE "User"."id" = ?',
              params: '["user_1"]',
              duration: 12,
            });
            return [{ id: "user_1" }];
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource: "{ where: { id: 'user_1' } }",
      },
    );

    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(prismaEvents).toEqual(["query"]);
    expect(body.timing.durationMs).toEqual(expect.any(Number));
    expect(body.timing.durationMs).toBeGreaterThanOrEqual(0);
    expect(body.sql.events).toEqual([
      {
        query: 'SELECT "User"."id" FROM "User" WHERE "User"."id" = ?',
        params: '["user_1"]',
        durationMs: 12,
      },
    ]);
  });

  it.each([
    ["findFirst", { where: { id: "user_1" } }, { id: "user_1" }],
    ["findUnique", { where: { id: "user_1" } }, { id: "user_1" }],
    ["count", { where: { id: "user_1" } }, 1],
  ] as const)("runs Query Lab %s through the validated model delegate", async (
    operation,
    expectedArgs,
    result,
  ) => {
    const calls: Array<{ operation: string; args: unknown }> = [];
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
          findFirst: async (args: unknown) => {
            calls.push({ operation: "findFirst", args });
            return result;
          },
          findUnique: async (args: unknown) => {
            calls.push({ operation: "findUnique", args });
            return result;
          },
          count: async (args: unknown) => {
            calls.push({ operation: "count", args });
            return result;
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation,
        argsSource: "{ where: { id: 'user_1' } }",
      },
    );

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([{ operation, args: expectedArgs }]);
    expect(JSON.parse(response.body)).toEqual({
      model: "User",
      operation,
      args: expectedArgs,
      normalizedArgs: expectedArgs,
      normalization: [],
      warnings: [],
      safetyLimits: {
        maxArgsDepth: 8,
        timeoutMs: 5000,
        maxResponseBytes: 262144,
        argsDepth: 2,
        responseSizeBytes: expect.any(Number),
      },
      prismaCall: `prisma.user.${operation}({\n  where: {\n    id: "user_1"\n  }\n})`,
      timing: {
        durationMs: expect.any(Number),
      },
      sql: {
        events: [],
      },
      result,
    });
    expect(JSON.parse(response.body).timing.durationMs).toBeGreaterThanOrEqual(0);
  });

  it.each(["findFirst", "findUnique"] as const)(
    "returns an empty single-record result for Query Lab %s misses",
    async (operation) => {
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
            [operation]: async () => null,
          },
        },
        disconnect: async () => undefined,
      });

      const response = await runMiddlewareWithJsonBody(
        middleware,
        { method: "POST", url: "/api/query-lab/preview" },
        {
          model: "User",
          operation,
          argsSource: "{ where: { id: 'missing' } }",
        },
      );

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        model: "User",
        operation,
        args: { where: { id: "missing" } },
        normalizedArgs: { where: { id: "missing" } },
        normalization: [],
        warnings: [],
        safetyLimits: {
          maxArgsDepth: 8,
          timeoutMs: 5000,
          maxResponseBytes: 262144,
          argsDepth: 2,
          responseSizeBytes: expect.any(Number),
        },
        prismaCall: `prisma.user.${operation}({\n  where: {\n    id: "missing"\n  }\n})`,
        timing: {
          durationMs: expect.any(Number),
        },
        sql: {
          events: [],
        },
        result: null,
      });
      expect(JSON.parse(response.body).timing.durationMs).toBeGreaterThanOrEqual(0);
    },
  );

  it("bounds excessive Query Lab take values before executing findMany", async () => {
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
              ],
            },
          },
        },
        user: {
          findMany: async (args: unknown) => {
            calls.push(args);
            return [];
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource: JSON.stringify({ where: { email: { contains: "example.com" } }, take: 500 }),
      },
    );

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      {
        where: { email: { contains: "example.com" } },
        take: 100,
      },
    ]);
    expect(JSON.parse(response.body)).toMatchObject({
      args: {
        where: { email: { contains: "example.com" } },
        take: 100,
      },
      normalizedArgs: {
        where: { email: { contains: "example.com" } },
        take: 100,
      },
      normalization: [
        {
          path: "take",
          action: "cap",
          reason: "findManyMaxTake",
          originalValue: 500,
          value: 100,
        },
      ],
    });
    expect(JSON.parse(response.body).prismaCall).toContain("prisma.user.findMany");
    expect(JSON.parse(response.body).prismaCall).toContain("take: 100");
  });

  it("returns deterministic Query Lab performance warnings from validated args", async () => {
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "email", type: "String", isUnique: true }),
                field({ name: "name", type: "String" }),
                field({ name: "createdAt", type: "DateTime" }),
                field({ name: "posts", kind: "object", type: "Post", isList: true }),
              ],
            },
            Post: {
              name: "Post",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "title", type: "String" }),
              ],
            },
          },
        },
        user: {
          findMany: async () => [],
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource: `{
          where: { name: { contains: "Ada" }, email: "ada@example.com" },
          include: { posts: true },
          orderBy: [{ createdAt: "desc" }],
          skip: 1500
        }`,
      },
    );

    expect(response.statusCode).toBe(200);
    const warnings = JSON.parse(response.body).warnings;
    expect(warnings).toEqual([
      {
        code: "FIND_MANY_DEFAULT_TAKE",
        path: "take",
        message:
          "findMany did not include an explicit take, so Query Lab applied the default preview cap.",
      },
      {
        code: "BROAD_SCALAR_SELECT",
        path: "select",
        message:
          "User returns all 4 scalar fields by default. Add a narrower select to reduce payload size.",
      },
      {
        code: "UNBOUNDED_INCLUDE",
        path: "include.posts",
        message:
          "include.posts includes a list relation without a nested take. Add a nested take to limit relation fanout.",
      },
      {
        code: "LARGE_SKIP",
        path: "skip",
        message:
          "skip is 1500. Large offset pagination can become slow; prefer a cursor or a more selective filter when possible.",
      },
      {
        code: "NON_UNIQUE_FILTER",
        path: "where.name",
        message:
          "where.name filters on User.name, which is not marked id or unique in Prisma metadata. This may scan more rows than expected.",
      },
      {
        code: "NON_UNIQUE_SORT",
        path: "orderBy.0.createdAt",
        message:
          "orderBy.0.createdAt sorts by User.createdAt, which is not marked id or unique in Prisma metadata. Sorting on non-unique fields may require extra database work.",
      },
    ]);
  });

  it("warns when Query Lab explicitly selects every scalar field", async () => {
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "email", type: "String" }),
              ],
            },
          },
        },
        user: {
          findMany: async () => [],
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource: "{ select: { id: true, email: true }, take: 10 }",
      },
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).warnings).toContainEqual({
      code: "BROAD_SCALAR_SELECT",
      path: "select",
      message: "User selects all 2 scalar fields. A narrower select can reduce payload size.",
    });
  });

  it("rejects Query Lab args that exceed the maximum nesting depth before reaching delegates", async () => {
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

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource:
          "{ where: { AND: [{ AND: [{ AND: [{ AND: [{ AND: [{ id: 'user_1' }] }] }] }] }] } }",
      },
    );

    expect(response.statusCode).toBe(400);
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "QUERY_LAB_SAFETY_LIMIT",
        message:
          "Query Lab safety limit exceeded: args nesting depth 12 exceeds the maximum of 8.",
      },
    });
  });

  it("fails Query Lab previews with a safety error when execution exceeds the timeout", async () => {
    vi.useFakeTimers();
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
          findMany: async () => new Promise(() => undefined),
        },
      },
      disconnect: async () => undefined,
    });

    const responsePromise = runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource: "{}",
      },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const response = await responsePromise;

    expect(response.statusCode).toBe(504);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "QUERY_LAB_SAFETY_LIMIT",
        message: "Query Lab safety limit exceeded: query did not finish within 5000 ms.",
      },
    });
  });

  it("fails Query Lab previews with a safety error when the serialized result is too large", async () => {
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
          findMany: async () => [{ id: "user_1", payload: "x".repeat(262_144) }],
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource: "{}",
      },
    );

    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "QUERY_LAB_SAFETY_LIMIT",
        message: expect.stringContaining(
          "Query Lab safety limit exceeded: serialized response size",
        ),
      },
    });
    expect(JSON.parse(response.body).error.message).toContain(
      "exceeds the maximum of 262144 bytes",
    );
  });

  it("rejects unknown Query Lab top-level findMany args before reaching delegates", async () => {
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

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource: "{ cursor: { id: 'user_1' } }",
      },
    );

    expect(response.statusCode).toBe(400);
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "INVALID_QUERY",
        message:
          "Unsupported Query Lab findMany arg: cursor. Supported args are where, select, include, orderBy, skip, take.",
      },
    });
  });

  it("rejects unsupported Query Lab count args before reaching delegates", async () => {
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
          count: async () => {
            delegateCalls.push("user.count");
            return 0;
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "count",
        argsSource: "{ select: { id: true } }",
      },
    );

    expect(response.statusCode).toBe(400);
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "INVALID_QUERY",
        message: "Unsupported Query Lab count arg: select. Supported args are where.",
      },
    });
  });

  it("rejects Query Lab findFirst take args before reaching delegates", async () => {
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
          findFirst: async () => {
            delegateCalls.push("user.findFirst");
            return null;
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findFirst",
        argsSource: "{ take: 10 }",
      },
    );

    expect(response.statusCode).toBe(400);
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "INVALID_QUERY",
        message:
          "Unsupported Query Lab findFirst arg: take. Supported args are where, select, include, orderBy, skip.",
      },
    });
  });

  it("rejects unknown Query Lab fields in supported args before reaching delegates", async () => {
    const delegateCalls: string[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          models: {
            User: {
              name: "User",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "email", type: "String" }),
              ],
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

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource: "{ where: { missingField: 'value' } }",
      },
    );

    expect(response.statusCode).toBe(400);
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "INVALID_QUERY",
        message: "Unknown field where.missingField on model User.",
      },
    });
  });

  it("rejects invalid Query Lab enum values before reaching delegates", async () => {
    const delegateCalls: string[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          enums: {
            Role: ["ADMIN", "USER"],
          },
          models: {
            User: {
              name: "User",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "role", kind: "enum", type: "Role" }),
              ],
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

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource: "{ where: { role: { in: ['ADMIN', 'OWNER'] } } }",
      },
    );

    expect(response.statusCode).toBe(400);
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "INVALID_QUERY",
        message: "Invalid enum value for where.role.in.1: OWNER. Expected one of ADMIN, USER.",
      },
    });
  });

  it("allows valid Query Lab where, select, include, and orderBy args", async () => {
    const calls: unknown[] = [];
    const middleware = createPrismaApiMiddleware({
      client: {
        _runtimeDataModel: {
          enums: {
            Role: ["ADMIN", "USER"],
          },
          models: {
            User: {
              name: "User",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "email", type: "String" }),
                field({ name: "role", kind: "enum", type: "Role" }),
                field({ name: "posts", kind: "object", type: "Post", isList: true }),
              ],
            },
            Post: {
              name: "Post",
              fields: [
                field({ name: "id", type: "String", isId: true }),
                field({ name: "title", type: "String" }),
                field({ name: "author", kind: "object", type: "User" }),
              ],
            },
          },
        },
        user: {
          findMany: async (args: unknown) => {
            calls.push(args);
            return [{ id: "user_1", email: "admin@example.com" }];
          },
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "findMany",
        argsSource: `{
          where: {
            OR: [
              { email: { contains: "example.com" } },
              { role: "ADMIN" }
            ]
          },
          select: {
            id: true,
            email: true,
            posts: {
              where: { title: { contains: "Prisma" } },
              select: { id: true, title: true },
              orderBy: [{ title: "asc" }],
              take: 5
            }
          },
          include: {
            posts: {
              where: { title: { startsWith: "Query" } },
              select: { id: true }
            }
          },
          orderBy: [{ email: "asc" }],
          skip: 0,
          take: 10
        }`,
      },
    );

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      {
        where: {
          OR: [{ email: { contains: "example.com" } }, { role: "ADMIN" }],
        },
        select: {
          id: true,
          email: true,
          posts: {
            where: { title: { contains: "Prisma" } },
            select: { id: true, title: true },
            orderBy: [{ title: "asc" }],
            take: 5,
          },
        },
        include: {
          posts: {
            where: { title: { startsWith: "Query" } },
            select: { id: true },
          },
        },
        orderBy: [{ email: "asc" }],
        skip: 0,
        take: 10,
      },
    ]);
  });

  it("rejects unknown Query Lab models before reaching any delegate", async () => {
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

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "Post",
        operation: "findMany",
        argsSource: "{}",
      },
    );

    expect(response.statusCode).toBe(404);
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "MODEL_NOT_FOUND",
        message: "Unknown Prisma model: Post.",
      },
    });
  });

  it("keeps Query Lab preview read-only by rejecting unsupported operations", async () => {
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

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation: "deleteMany",
        argsSource: "{}",
      },
    );

    expect(response.statusCode).toBe(400);
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: "OPERATION_NOT_SUPPORTED",
        message: "Query Lab supports only findMany, findFirst, findUnique, and count.",
      },
    });
  });

  it.each([
    "create",
    "createMany",
    "update",
    "updateMany",
    "upsert",
    "delete",
    "deleteMany",
    "$queryRaw",
    "$queryRawUnsafe",
    "$executeRaw",
    "$executeRawUnsafe",
    "$transaction",
  ])("rejects Query Lab unsafe operation %s before reaching delegates", async (operation) => {
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
        $queryRaw: async () => {
          delegateCalls.push("$queryRaw");
          return [];
        },
        $transaction: async () => {
          delegateCalls.push("$transaction");
          return [];
        },
      },
      disconnect: async () => undefined,
    });

    const response = await runMiddlewareWithJsonBody(
      middleware,
      { method: "POST", url: "/api/query-lab/preview" },
      {
        model: "User",
        operation,
        argsSource: "{}",
      },
    );

    expect(response.statusCode).toBe(400);
    expect(delegateCalls).toEqual([]);
    expect(JSON.parse(response.body)).toMatchObject({
      error: {
        code: "OPERATION_NOT_SUPPORTED",
      },
    });
  });
});

function makeContext(): StartupContext {
  return {
    appRoot: "/target-app",
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

function runMiddlewareWithJsonBody(
  middleware: ReturnType<typeof createPrismaApiMiddleware>,
  request: { method: string; url: string },
  body: unknown,
) {
  const stream = Readable.from([JSON.stringify(body)]) as Readable & {
    method: string;
    url: string;
  };
  stream.method = request.method;
  stream.url = request.url;
  const response = makeResponse();
  return Promise.resolve(middleware(stream as never, response as never, () => undefined)).then(
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
