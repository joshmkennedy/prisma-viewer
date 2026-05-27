import { describe, expect, it } from "vitest";
import { startViewerServer } from "../../src/node/server";
import type { StartupContext } from "../../src/node/startup";

describe("startViewerServer", () => {
  it("starts Vite and returns the local URL", async () => {
    const calls: unknown[] = [];
    const fakeServer = {
      httpServer: {
        address: () => ({ port: 5678 }),
      },
      listen: async () => undefined,
    };

    const result = await startViewerServer(makeContext(), {
      host: "localhost",
      port: 5678,
      viewerRoot: "/viewer",
      createServerImpl: (async (config: unknown) => {
        calls.push(config);
        return fakeServer;
      }) as never,
    });

    expect(result.url).toBe("http://localhost:5678/");
    expect(result.server).toBe(fakeServer);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      root: "/viewer",
      server: { host: "localhost", port: 5678 },
    });
  });
});

function makeContext(): StartupContext {
  return {
    appRoot: "/target-app",
    databaseUrl: "file:./dev.db",
    loadedEnvFiles: ["/target-app/.env.local"],
    prismaClientPath: "/target-app/node_modules/@prisma/client/index.js",
  };
}
