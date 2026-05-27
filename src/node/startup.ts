import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { StartupError } from "./errors.js";
import { loadAppEnv } from "./env.js";

export type StartupOptions = {
  appRoot?: string;
  cwd?: string;
};

export type StartupContext = {
  appRoot: string;
  databaseUrl: string;
  loadedEnvFiles: string[];
  prismaClientPath: string;
};

export function prepareStartup(options: StartupOptions = {}): StartupContext {
  const appRoot = path.resolve(options.cwd ?? process.cwd(), options.appRoot ?? ".");

  if (!existsSync(appRoot) || !statSync(appRoot).isDirectory()) {
    throw new StartupError(`App root does not exist or is not a directory: ${appRoot}`);
  }

  const { env, loadedFiles } = loadAppEnv(appRoot);
  const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL;

  if (loadedFiles.length === 0) {
    throw new StartupError(
      `No environment file found in ${appRoot}. Add .env.local or .env with DATABASE_URL before starting Prisma Viewer.`,
    );
  }

  if (!databaseUrl) {
    throw new StartupError(
      `Database configuration is missing. ${loadedFiles.map((file) => path.basename(file)).join(" and ")} did not define DATABASE_URL.`,
    );
  }

  return {
    appRoot,
    databaseUrl,
    loadedEnvFiles: loadedFiles,
    prismaClientPath: resolvePrismaClient(appRoot),
  };
}

function resolvePrismaClient(appRoot: string) {
  try {
    return createRequire(path.join(appRoot, "package.json")).resolve("@prisma/client");
  } catch {
    throw new StartupError(
      `Prisma Client is not installed in ${appRoot}. Install @prisma/client and run prisma generate for the target app.`,
    );
  }
}
