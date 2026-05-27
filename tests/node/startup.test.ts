import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "../../src/node/cli";
import { StartupError } from "../../src/node/errors";
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
    expect(parseArgs([])).toEqual({ help: false });
  });

  it("accepts positional root, host, and port", () => {
    expect(parseArgs(["../app", "--host", "localhost", "--port=5555"])).toEqual({
      appRoot: "../app",
      help: false,
      host: "localhost",
      port: 5555,
    });
  });
});

describe("prepareStartup", () => {
  it("defaults the app root to the current working directory", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({ env: "DATABASE_URL=file:./dev.db\n", prismaClient: true });

    const context = prepareStartup({ cwd: appRoot });

    expect(context.appRoot).toBe(appRoot);
    expect(context.databaseUrl).toBe("file:./dev.db");
    expect(context.prismaClientPath).toContain("@prisma/client");
  });

  it("reports missing env files clearly", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({ prismaClient: true });

    expect(() => prepareStartup({ cwd: appRoot })).toThrow(
      /No environment file found.*Add \.env\.local or \.env with DATABASE_URL/,
    );
  });

  it("reports missing database configuration clearly", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({ env: "APP_ENV=development\n", prismaClient: true });

    expect(() => prepareStartup({ cwd: appRoot })).toThrow(
      /Database configuration is missing.*DATABASE_URL/,
    );
  });

  it("reports missing Prisma Client clearly", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp({ env: "DATABASE_URL=file:./dev.db\n" });

    expect(() => prepareStartup({ cwd: appRoot })).toThrow(StartupError);
    expect(() => prepareStartup({ cwd: appRoot })).toThrow(
      /Prisma Client is not installed.*Install @prisma\/client/,
    );
  });
});

function makeTempApp(options: { env?: string; prismaClient?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "prisma-viewer-startup-"));
  createdDirs.push(dir);

  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));

  if (options.env !== undefined) {
    writeFileSync(path.join(dir, ".env"), options.env);
  }

  if (options.prismaClient) {
    const clientDir = path.join(dir, "node_modules", "@prisma", "client");
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(
      path.join(clientDir, "package.json"),
      JSON.stringify({ name: "@prisma/client", main: "index.js" }),
    );
    writeFileSync(path.join(clientDir, "index.js"), "export const PrismaClient = class {};\n");
  }

  return dir;
}
