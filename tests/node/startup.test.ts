import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "../../src/node/cli";
import { StartupError } from "../../src/node/errors";
import { createTargetPrismaRuntime } from "../../src/node/prisma";
import { prepareStartup } from "../../src/node/startup";

const createdDirs: string[] = [];
let originalDatabaseUrl: string | undefined;

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }

  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe("parseArgs", () => {
  it("keeps the target app root optional so startup defaults to cwd", () => {
    expect(parseArgs([])).toEqual({ help: false, open: true });
  });

  it("accepts positional root, host, and port", () => {
    expect(parseArgs(["../app", "--host", "localhost", "--port=5555"])).toEqual({
      appRoot: "../app",
      help: false,
      host: "localhost",
      open: true,
      port: 5555,
    });
  });

  it("accepts an explicit env file", () => {
    expect(parseArgs(["--env-file", ".env.dev.local"])).toEqual({
      envFile: ".env.dev.local",
      help: false,
      open: true,
    });
  });

  it("can disable browser opening for scripts and CI", () => {
    expect(parseArgs(["--no-open"])).toEqual({ help: false, open: false });
  });
});

describe("prepareStartup", () => {
  it("defaults the app root to the current working directory", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({
      env: "DATABASE_URL=file:./dev.db\n",
      prisma: true,
      prismaClient: true,
    });

    const context = prepareStartup({ cwd: appRoot });

    expect(context.appRoot).toBe(appRoot);
    expect(context.prismaPackagePath).toContain("prisma");
    expect(context.prismaClientPath).toContain("@prisma/client");
  });

  it("does not require env files when relying on the shell environment", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://shell";
    const appRoot = makeTempApp({ prisma: true, prismaClient: true });

    const context = prepareStartup({ cwd: appRoot });

    expect(context.loadedEnvFiles).toEqual([]);
  });

  it("loads an explicit env file relative to the app root", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({ prisma: true, prismaClient: true });
    writeFileSync(path.join(appRoot, ".env.dev.local"), "DATABASE_URL=postgres://dev\n");

    const context = prepareStartup({ cwd: appRoot, envFile: ".env.dev.local" });

    expect(context.loadedEnvFiles.map((file) => path.basename(file))).toEqual([
      ".env.dev.local",
    ]);
  });

  it("reports a missing explicit env file clearly", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({ prisma: true, prismaClient: true });

    expect(() => prepareStartup({ cwd: appRoot, envFile: ".env.dev.local" })).toThrow(
      /Env file does not exist.*\.env\.dev\.local/,
    );
  });

  it("does not require a literal DATABASE_URL during startup preflight", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({ prisma: true, prismaClient: true });

    const context = prepareStartup({ cwd: appRoot });

    expect(context.loadedEnvFiles).toEqual([]);
  });

  it("allows env files that do not define DATABASE_URL during startup preflight", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({
      env: "APP_ENV=development\n",
      prisma: true,
      prismaClient: true,
    });

    const context = prepareStartup({ cwd: appRoot });

    expect(context.loadedEnvFiles.map((file) => path.basename(file))).toEqual([".env"]);
  });

  it("reports missing Prisma package clearly", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({ env: "DATABASE_URL=file:./dev.db\n" });

    expect(() => prepareStartup({ cwd: appRoot })).toThrow(StartupError);
    expect(() => prepareStartup({ cwd: appRoot })).toThrow(
      /Prisma is not installed.*Install prisma/,
    );
  });

  it("reports missing Prisma Client clearly", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({ env: "DATABASE_URL=file:./dev.db\n", prisma: true });

    expect(() => prepareStartup({ cwd: appRoot })).toThrow(StartupError);
    expect(() => prepareStartup({ cwd: appRoot })).toThrow(
      /Prisma Client is not installed.*Install @prisma\/client/,
    );
  });
});

describe("createTargetPrismaRuntime", () => {
  it("loads and connects the generated Prisma Client from the target app", async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({
      env: "DATABASE_URL=file:./dev.db\n",
      prisma: true,
      prismaClient: true,
    });
    const context = prepareStartup({ cwd: appRoot });

    const runtime = await createTargetPrismaRuntime(context);

    expect(globalThis.__prismaViewerTestEvents).toEqual(["construct", "connect"]);

    await runtime.disconnect();

    expect(globalThis.__prismaViewerTestEvents).toEqual([
      "construct",
      "connect",
      "disconnect",
    ]);
  });

  it("reports missing generated client clearly", async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({
      env: "DATABASE_URL=file:./dev.db\n",
      prisma: true,
      prismaClient: "missing-generated",
    });
    const context = prepareStartup({ cwd: appRoot });

    await expect(createTargetPrismaRuntime(context)).rejects.toThrow(StartupError);
    await expect(createTargetPrismaRuntime(context)).rejects.toThrow(
      /generated Prisma Client is missing.*prisma generate/,
    );
  });

  it("reports generation-related initialization failures clearly", async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({
      env: "DATABASE_URL=file:./dev.db\n",
      prisma: true,
      prismaClient: "connect-failure",
    });
    const context = prepareStartup({ cwd: appRoot });

    await expect(createTargetPrismaRuntime(context)).rejects.toThrow(
      /Could not initialize.*schema engine unavailable.*prisma generate/,
    );
  });

  it("reports the datasource env var Prisma Client expects", async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({
      env: "APP_ENV=development\n",
      prisma: true,
      prismaClient: "missing-datasource-env",
    });
    const context = prepareStartup({ cwd: appRoot });

    await expect(createTargetPrismaRuntime(context)).rejects.toThrow(StartupError);
    await expect(createTargetPrismaRuntime(context)).rejects.toThrow(
      /Prisma schema expects POSTGRES_URL.*\.env/,
    );
  });
});

function makeTempApp(
  options: {
    env?: string;
    prisma?: boolean;
    prismaClient?: boolean | "missing-generated" | "connect-failure" | "missing-datasource-env";
  } = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), "prisma-pad-startup-"));
  createdDirs.push(dir);

  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));

  if (options.env !== undefined) {
    writeFileSync(path.join(dir, ".env"), options.env);
  }

  if (options.prisma) {
    const prismaDir = path.join(dir, "node_modules", "prisma");
    mkdirSync(prismaDir, { recursive: true });
    writeFileSync(
      path.join(prismaDir, "package.json"),
      JSON.stringify({ name: "prisma", version: "0.0.0" }),
    );
  }

  if (options.prismaClient) {
    const clientDir = path.join(dir, "node_modules", "@prisma", "client");
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(
      path.join(clientDir, "package.json"),
      JSON.stringify({ name: "@prisma/client", main: "index.js" }),
    );
    writeFileSync(path.join(clientDir, "index.js"), prismaClientFixture(options.prismaClient));
  }

  return dir;
}

function prismaClientFixture(
  kind: true | "missing-generated" | "connect-failure" | "missing-datasource-env",
) {
  if (kind === "missing-generated") {
    return "throw new Error('@prisma/client did not initialize yet. Please run prisma generate.');\n";
  }

  if (kind === "connect-failure") {
    return `
class PrismaClient {
  async $connect() {
    throw new Error('schema engine unavailable');
  }
  async $disconnect() {
    globalThis.__prismaViewerTestEvents = [...(globalThis.__prismaViewerTestEvents ?? []), 'disconnect'];
  }
}
module.exports = { PrismaClient };
`;
  }

  if (kind === "missing-datasource-env") {
    return `
class PrismaClient {
  async $connect() {
    throw new Error('Environment variable not found: POSTGRES_URL.');
  }
  async $disconnect() {
    globalThis.__prismaViewerTestEvents = [...(globalThis.__prismaViewerTestEvents ?? []), 'disconnect'];
  }
}
module.exports = { PrismaClient };
`;
  }

  return `
globalThis.__prismaViewerTestEvents = [];
class PrismaClient {
  constructor() {
    globalThis.__prismaViewerTestEvents.push('construct');
  }
  async $connect() {
    globalThis.__prismaViewerTestEvents.push('connect');
  }
  async $disconnect() {
    globalThis.__prismaViewerTestEvents.push('disconnect');
  }
}
module.exports = { PrismaClient };
`;
}

declare global {
  // eslint-disable-next-line no-var
  var __prismaViewerTestEvents: string[] | undefined;
}
