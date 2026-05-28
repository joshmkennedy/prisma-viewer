import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { createPrismaApiMiddleware } from "./api.js";
import { createTargetPrismaRuntime, type PrismaRuntime } from "./prisma.js";
import type { StartupContext } from "./startup.js";

export type ServerOptions = {
  host?: string;
  port?: number;
  viewerRoot?: string;
  createServerImpl?: typeof createServer;
  createPrismaRuntimeImpl?: (context: StartupContext) => Promise<PrismaRuntime>;
};

export type StartedServer = {
  server: ViteDevServer;
  url: string;
};

export async function startViewerServer(
  context: StartupContext,
  options: ServerOptions = {},
): Promise<StartedServer> {
  const viewerRoot = options.viewerRoot ?? findViewerRoot();
  const prismaRuntime = await (options.createPrismaRuntimeImpl ?? createTargetPrismaRuntime)(
    context,
  );
  const apiMiddleware = createPrismaApiMiddleware(prismaRuntime);
  let server: ViteDevServer | undefined;

  try {
    server = await (options.createServerImpl ?? createServer)({
      root: viewerRoot,
      configFile: join(viewerRoot, "vite.config.ts"),
      plugins: [prismaApiPlugin(apiMiddleware)],
      server: {
        host: options.host ?? "127.0.0.1",
        port: options.port ?? 0,
      },
      define: {
        __PRISMA_VIEWER_APP_ROOT__: JSON.stringify(context.appRoot),
      },
    });

    bindPrismaLifecycle(server, prismaRuntime);
    await server.listen();
  } catch (error) {
    await prismaRuntime.disconnect().catch(() => undefined);
    throw error;
  }

  const address = server.httpServer?.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  const host = options.host ?? "127.0.0.1";

  return {
    server,
    url: `http://${host}:${port ?? 5173}/`,
  };
}

function prismaApiPlugin(
  middleware: ReturnType<typeof createPrismaApiMiddleware>,
): Plugin {
  return {
    name: "prisma-pad-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function bindPrismaLifecycle(server: ViteDevServer, prismaRuntime: PrismaRuntime) {
  const close = server.close.bind(server);
  server.close = async () => {
    await prismaRuntime.disconnect();
    await close();
  };
}

function findViewerRoot() {
  let current = dirname(fileURLToPath(import.meta.url));

  while (true) {
    const packageJsonPath = join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        name?: string;
      };

      if (packageJson.name === "prisma-pad") {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Could not find prisma-pad package root.");
    }
    current = parent;
  }
}
