import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { StartupError } from "./errors.js";
import type { StartupContext } from "./startup.js";

export type PrismaClientLike = {
  $connect?: () => Promise<void>;
  $disconnect?: () => Promise<void>;
  $on?: (event: "query", handler: (event: unknown) => void) => void;
  [delegateName: string]: unknown;
};

type PrismaClientConstructor = new (options?: unknown) => PrismaClientLike;

export type PrismaRuntime = {
  client: PrismaClientLike;
  disconnect: () => Promise<void>;
};

export async function createTargetPrismaRuntime(
  context: StartupContext,
): Promise<PrismaRuntime> {
  let PrismaClient: PrismaClientConstructor;

  try {
    const clientModule = await loadPrismaClientModule(context);
    PrismaClient = clientModule.PrismaClient as PrismaClientConstructor;
  } catch (error) {
    throw prismaClientLoadError(context, error);
  }

  if (typeof PrismaClient !== "function") {
    throw new StartupError(
      `The generated Prisma Client in ${context.appRoot} did not export PrismaClient. Run prisma generate in the target app and restart Prisma Pad.`,
    );
  }

  let client: PrismaClientLike;
  try {
    client = new PrismaClient({
      log: [{ emit: "event", level: "query" }],
    });
  } catch (error) {
    if (isMissingGeneratedClientError(error)) {
      throw missingGeneratedClientError(context);
    }
    throw prismaClientGenerationError(context, error);
  }

  try {
    await client.$connect?.();
  } catch (error) {
    await client.$disconnect?.().catch(() => undefined);
    if (isMissingGeneratedClientError(error)) {
      throw missingGeneratedClientError(context);
    }
    throw prismaClientGenerationError(context, error);
  }

  return {
    client,
    disconnect: async () => {
      await client.$disconnect?.();
    },
  };
}

async function loadPrismaClientModule(context: StartupContext) {
  const requireFromApp = createRequire(path.join(context.appRoot, "package.json"));

  try {
    return requireFromApp(context.prismaClientPath) as Record<string, unknown>;
  } catch (error) {
    if (isEsmRequireError(error)) {
      return import(pathToFileURL(context.prismaClientPath).href) as Promise<
        Record<string, unknown>
      >;
    }
    throw error;
  }
}

function prismaClientLoadError(context: StartupContext, error: unknown) {
  if (isMissingGeneratedClientError(error)) {
    return missingGeneratedClientError(context);
  }

  return prismaClientGenerationError(context, error);
}

function missingGeneratedClientError(context: StartupContext) {
  return new StartupError(
    `The generated Prisma Client is missing for ${context.appRoot}. Run prisma generate in the target app, then restart Prisma Pad.`,
  );
}

function prismaClientGenerationError(context: StartupContext, error: unknown) {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
  return new StartupError(
    `Could not initialize the generated Prisma Client for ${context.appRoot}.${detail} Run prisma generate in the target app and verify DATABASE_URL points at a reachable development database.`,
  );
}

function isEsmRequireError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ERR_REQUIRE_ESM"
  );
}

function isMissingGeneratedClientError(error: unknown) {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("did not initialize yet") ||
    message.includes("prisma generate") ||
    message.includes(".prisma/client") ||
    message.includes("generated prisma client")
  );
}
