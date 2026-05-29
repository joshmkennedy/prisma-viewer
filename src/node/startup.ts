import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { StartupError } from "./errors.js";
import { loadAppEnv } from "./env.js";

export type StartupOptions = {
  appRoot?: string;
  envFile?: string;
  cwd?: string;
};

export type StartupContext = {
  appRoot: string;
  loadedEnvFiles: string[];
  prismaPackagePath: string;
  prismaClientPath: string;
};

export function prepareStartup(options: StartupOptions = {}): StartupContext {
  const appRoot = path.resolve(options.cwd ?? process.cwd(), options.appRoot ?? ".");

  if (!existsSync(appRoot) || !statSync(appRoot).isDirectory()) {
    throw new StartupError(`App root does not exist or is not a directory: ${appRoot}`);
  }

  const envFile = options.envFile ? resolveEnvFilePath(appRoot, options.envFile) : undefined;
  const { loadedFiles } = loadAppEnv(appRoot, { envFile });

  return {
    appRoot,
    loadedEnvFiles: loadedFiles,
    prismaPackagePath: resolvePrismaPackage(appRoot),
    prismaClientPath: resolvePrismaClient(appRoot),
  };
}

function resolveEnvFilePath(appRoot: string, envFile: string) {
  const resolved = path.isAbsolute(envFile) ? envFile : path.resolve(appRoot, envFile);

  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new StartupError(`Env file does not exist or is not a file: ${resolved}`);
  }

  return resolved;
}

function resolvePrismaPackage(appRoot: string) {
  try {
    return createRequire(path.join(appRoot, "package.json")).resolve("prisma/package.json");
  } catch {
    throw new StartupError(
      `Prisma is not installed in ${appRoot}. Install prisma in the target app before starting Prisma Pad.`,
    );
  }
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
