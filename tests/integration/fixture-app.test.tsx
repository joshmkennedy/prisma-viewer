// @vitest-environment jsdom

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app";
import { createPrismaApiMiddleware } from "../../src/node/api";
import { createTargetPrismaRuntime } from "../../src/node/prisma";
import type { PrismaRuntime } from "../../src/node/prisma";
import { prepareStartup, type StartupContext } from "../../src/node/startup";

const projectRoot = process.cwd();
const fixtureRoot = path.join(projectRoot, "tests", "fixtures", "prisma-app");
const prismaBin = path.join(projectRoot, "node_modules", ".bin", "prisma");

let appRoot: string;
let context: StartupContext;
let server: StartedApiServer | undefined;
let originalFetch: typeof fetch;
let originalDatabaseUrl: string | undefined;

type StartedApiServer = {
  close: () => Promise<void>;
  runtime: PrismaRuntime;
  url: string;
};

beforeAll(() => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  appRoot = mkdtempSync(path.join(tmpdir(), "prisma-pad-fixture-"));
  cpSync(fixtureRoot, appRoot, { recursive: true });
  symlinkSync(path.join(projectRoot, "node_modules"), path.join(appRoot, "node_modules"));

  execFileSync(prismaBin, ["generate", "--schema", "prisma/schema.prisma"], {
    cwd: appRoot,
    stdio: "pipe",
  });
  execFileSync(prismaBin, ["db", "push", "--schema", "prisma/schema.prisma"], {
    cwd: appRoot,
    stdio: "pipe",
  });
  execFileSync(
    process.execPath,
    [
      "-e",
      `
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  await prisma.post.deleteMany();
  await prisma.user.deleteMany();
  const ada = await prisma.user.create({
    data: { email: "ada@example.com", name: "Ada Lovelace" },
  });
  await prisma.post.create({
    data: { title: "Analytical Engine Notes", published: true, authorId: ada.id },
  });
  await prisma.user.create({
    data: { email: "grace@example.com", name: "Grace Hopper" },
  });
}
main().finally(async () => prisma.$disconnect());
`,
    ],
    { cwd: appRoot, stdio: "pipe" },
  );

  context = prepareStartup({ cwd: appRoot });
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();

  if (server) {
    await server.close();
    server = undefined;
  }
});

afterAll(() => {
  rmSync(appRoot, { recursive: true, force: true });

  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe("fixture Prisma app integration", () => {
  it(
    "starts against a local fixture database and drives metadata, rows, and preview UI",
    async () => {
      expect(context.appRoot).toBe(appRoot);
      expect(context.databaseUrl).toBe("file:./dev.db");
      expect(context.loadedEnvFiles.map((file) => path.basename(file))).toEqual([".env"]);
      expect(context.prismaClientPath).toContain("@prisma/client");
      expect(context.prismaPackagePath).toContain("prisma");

      server = await startApiServer(context);
      expect(server.runtime.client.user).toBeTruthy();
      originalFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), server?.url);
        return originalFetch(url, init);
      });

      const metadataResponse = await originalFetch(new URL("/api/models", server.url));
      expect(metadataResponse.status).toBe(200);
      const metadata = await metadataResponse.json();
      expect(metadata.models.map((model: { name: string }) => model.name)).toEqual([
        "Post",
        "User",
      ]);

      const rowsResponse = await originalFetch(
        new URL("/api/models/User/rows?page=1&pageSize=1", server.url),
      );
      expect(rowsResponse.status).toBe(200);
      const rowsPayload = await rowsResponse.json();
      expect(rowsPayload.pagination).toEqual({ page: 1, pageSize: 1 });
      expect(rowsPayload.rows).toHaveLength(1);
      expect(Object.keys(rowsPayload.rows[0]).sort()).toEqual([
        "createdAt",
        "email",
        "id",
        "name",
      ]);

      renderApp();

      await userEvent.click(
        await screen.findByRole("button", { name: "User model, 5 fields" }),
      );
      expect(await screen.findByText("2 rows loaded, 4 columns shown")).toBeTruthy();
      await userEvent.click(await screen.findByText("grace@example.com"));

      const preview = screen.getByRole("heading", { name: "Record Preview" }).closest("aside");
      expect(preview).toBeTruthy();
      expect(within(preview as HTMLElement).getAllByText("Grace Hopper").length).toBeGreaterThan(
        0,
      );
      expect(
        within(preview as HTMLElement).getAllByText("grace@example.com").length,
      ).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "runs Query Lab previews against the fixture Prisma app and reports inspector data",
    async () => {
      server = await startApiServer(context);
      originalFetch = globalThis.fetch;

      const queryResponse = await originalFetch(new URL("/api/query-lab/preview", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "User",
          operation: "findMany",
          argsSource: `{
            where: { email: { contains: "ada" } },
            select: { email: true, name: true },
            take: 5
          }`,
        }),
      });

      expect(queryResponse.status).toBe(200);
      const queryPayload = await queryResponse.json();
      expect(queryPayload).toMatchObject({
        model: "User",
        operation: "findMany",
        args: {
          where: { email: { contains: "ada" } },
          select: { email: true, name: true },
          take: 5,
        },
        normalizedArgs: {
          where: { email: { contains: "ada" } },
          select: { email: true, name: true },
          take: 5,
        },
        normalization: [],
        result: [{ email: "ada@example.com", name: "Ada Lovelace" }],
        rows: [{ email: "ada@example.com", name: "Ada Lovelace" }],
      });
      expect(queryPayload.prismaCall).toContain("prisma.user.findMany");
      expect(queryPayload.timing.durationMs).toEqual(expect.any(Number));
      expect(queryPayload.timing.durationMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(queryPayload.sql.events)).toBe(true);

      if (queryPayload.sql.events.length > 0) {
        expect(queryPayload.sql.events[0]).toMatchObject({
          query: expect.any(String),
          params: expect.any(String),
          durationMs: expect.any(Number),
        });
      } else {
        expect(queryPayload.sql.events).toEqual([]);
      }

      const invalidResponse = await originalFetch(new URL("/api/query-lab/preview", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "User",
          operation: "findMany",
          argsSource: "{ where: { unknownFixtureField: 'Ada' } }",
        }),
      });

      expect(invalidResponse.status).toBe(400);
      expect(await invalidResponse.json()).toEqual({
        error: {
          code: "INVALID_QUERY",
          message: "Unknown field where.unknownFixtureField on model User.",
        },
      });
    },
    60_000,
  );
});

async function startApiServer(context: StartupContext): Promise<StartedApiServer> {
  const runtime = await createTargetPrismaRuntime(context);
  const middleware = createPrismaApiMiddleware(runtime);
  const httpServer = createServer((request, response) => {
    void middleware(request, response, () => {
      response.statusCode = 404;
      response.end("Not found");
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  return {
    close: async () => {
      await runtime.disconnect();
      await closeHttpServer(httpServer);
    },
    runtime,
    url: serverUrl(httpServer),
  };
}

function serverUrl(server: Server) {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture API server did not bind to a TCP port.");
  }

  return `http://127.0.0.1:${address.port}/`;
}

function closeHttpServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function renderApp(path = "/") {
  vi.stubGlobal("scrollTo", vi.fn());
  window.history.replaceState(null, "", path);
  return render(<App />);
}
