import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import type { StartupContext } from "./startup.js";

export type ServerOptions = {
  host?: string;
  port?: number;
  viewerRoot?: string;
  createServerImpl?: typeof createServer;
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
  const server = await (options.createServerImpl ?? createServer)({
    root: viewerRoot,
    configFile: join(viewerRoot, "vite.config.ts"),
    server: {
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 0,
    },
    define: {
      __PRISMA_VIEWER_APP_ROOT__: JSON.stringify(context.appRoot),
    },
  });

  await server.listen();

  const address = server.httpServer?.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  const host = options.host ?? "127.0.0.1";

  return {
    server,
    url: `http://${host}:${port ?? 5173}/`,
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

      if (packageJson.name === "prisma-viewer") {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error("Could not find prisma-viewer package root.");
    }
    current = parent;
  }
}
