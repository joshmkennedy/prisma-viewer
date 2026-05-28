#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { StartupError } from "./errors.js";
import { startViewerServer } from "./server.js";
import { prepareStartup } from "./startup.js";

type CliOptions = {
  appRoot?: string;
  host?: string;
  open: boolean;
  port?: number;
  help: boolean;
};

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);

    if (options.help) {
      console.log(helpText());
      return 0;
    }

    const context = prepareStartup({ appRoot: options.appRoot });
    const { url } = await startViewerServer(context, {
      host: options.host,
      port: options.port,
    });

    console.log(`Prisma Pad running at ${url}`);
    console.log(`App root: ${context.appRoot}`);
    if (context.loadedEnvFiles.length > 0) {
      console.log(
        `Loaded env: ${context.loadedEnvFiles.map((file) => path.basename(file)).join(", ")}`,
      );
    } else {
      console.log("Loaded env: shell environment");
    }

    if (options.open) {
      openBrowser(url);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      error instanceof StartupError ? message : `Failed to start Prisma Pad: ${message}`,
    );
    return 1;
  }
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { help: false, open: true };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--root") {
      options.appRoot = requireValue(argv, ++index, "--root");
    } else if (arg.startsWith("--root=")) {
      options.appRoot = arg.slice("--root=".length);
    } else if (arg === "--host") {
      options.host = requireValue(argv, ++index, "--host");
    } else if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
    } else if (arg === "--open") {
      options.open = true;
    } else if (arg === "--no-open") {
      options.open = false;
    } else if (arg === "--port") {
      options.port = parsePort(requireValue(argv, ++index, "--port"));
    } else if (arg.startsWith("--port=")) {
      options.port = parsePort(arg.slice("--port=".length));
    } else if (arg.startsWith("-")) {
      throw new StartupError(`Unknown option: ${arg}`);
    } else if (!options.appRoot) {
      options.appRoot = arg;
    } else {
      throw new StartupError(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

export function openBrowser(url: string) {
  const opener =
    process.platform === "darwin"
      ? { command: "open", args: [url] }
      : process.platform === "win32"
        ? { command: "cmd", args: ["/c", "start", "", url] }
        : { command: "xdg-open", args: [url] };

  try {
    const child = spawn(opener.command, opener.args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });
    child.unref();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Could not open browser automatically: ${message}`);
  }
}

function requireValue(argv: string[], index: number, option: string) {
  const value = argv[index];
  if (!value || value.startsWith("-")) {
    throw new StartupError(`${option} requires a value.`);
  }
  return value;
}

function parsePort(value: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new StartupError(`Invalid port: ${value}`);
  }
  return port;
}

function helpText() {
  return `Usage: prisma-pad [app-root] [--root <path>] [--host <host>] [--port <port>] [--no-open]

Starts Prisma Pad against a local Prisma app.

Options:
  --root <path>   Target app root. Defaults to the current working directory.
  --host <host>   Host for the local viewer server. Defaults to 127.0.0.1.
  --port <port>   Port for the local viewer server. Defaults to an open port.
  --open          Open the viewer in the default browser. Enabled by default.
  --no-open       Print the viewer URL without opening a browser.
  -h, --help      Show this help.`;
}

function isDirectCliInvocation() {
  if (!process.argv[1]) return false;

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isDirectCliInvocation()) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
