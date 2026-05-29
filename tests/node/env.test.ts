import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAppEnv, parseEnvFile } from "../../src/node/env";

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

describe("parseEnvFile", () => {
  it("parses common env syntax", () => {
    expect(
      parseEnvFile(`
        # ignored
        DATABASE_URL="file:./dev.db"
        DIRECT_URL='postgres://direct'
        export FEATURE_FLAG=true # comment
      `),
    ).toEqual({
      DATABASE_URL: "file:./dev.db",
      DIRECT_URL: "postgres://direct",
      FEATURE_FLAG: "true",
    });
  });
});

describe("loadAppEnv", () => {
  it("falls back to .env when .env.local is missing", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp();
    writeFileSync(path.join(appRoot, ".env"), "DATABASE_URL=file:./dev.db\n");

    const result = loadAppEnv(appRoot);

    expect(result.env.DATABASE_URL).toBe("file:./dev.db");
    expect(process.env.DATABASE_URL).toBe("file:./dev.db");
    expect(result.loadedFiles.map((file) => path.basename(file))).toEqual([".env"]);
  });

  it("gives .env.local precedence when both env files exist", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://shell";
    const appRoot = makeTempApp();
    writeFileSync(path.join(appRoot, ".env"), "DATABASE_URL=postgres://base\nSHARED=base\n");
    writeFileSync(
      path.join(appRoot, ".env.local"),
      "DATABASE_URL=postgres://local\nLOCAL_ONLY=true\n",
    );

    const result = loadAppEnv(appRoot);

    expect(result.env).toMatchObject({
      DATABASE_URL: "postgres://local",
      SHARED: "base",
      LOCAL_ONLY: "true",
    });
    expect(process.env.DATABASE_URL).toBe("postgres://local");
    expect(result.loadedFiles.map((file) => path.basename(file))).toEqual([
      ".env.local",
      ".env",
    ]);
  });

  it("gives an explicit env file precedence over default env files", () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const appRoot = makeTempApp();
    const explicitEnvFile = path.join(appRoot, ".env.dev.local");
    writeFileSync(path.join(appRoot, ".env"), "DATABASE_URL=postgres://base\nSHARED=base\n");
    writeFileSync(path.join(appRoot, ".env.local"), "DATABASE_URL=postgres://local\n");
    writeFileSync(explicitEnvFile, "DATABASE_URL=postgres://dev\nDEV_ONLY=true\n");

    const result = loadAppEnv(appRoot, { envFile: explicitEnvFile });

    expect(result.env).toMatchObject({
      DATABASE_URL: "postgres://dev",
      SHARED: "base",
      DEV_ONLY: "true",
    });
    expect(process.env.DATABASE_URL).toBe("postgres://dev");
    expect(result.loadedFiles.map((file) => path.basename(file))).toEqual([
      ".env.dev.local",
      ".env.local",
      ".env",
    ]);
  });
});

function makeTempApp() {
  const dir = mkdtempSync(path.join(tmpdir(), "prisma-pad-env-"));
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}
