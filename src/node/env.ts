import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type EnvLoadResult = {
  env: Record<string, string>;
  loadedFiles: string[];
};

export function loadAppEnv(appRoot: string): EnvLoadResult {
  const envFile = path.join(appRoot, ".env");
  const localEnvFile = path.join(appRoot, ".env.local");
  const loadedFiles: string[] = [];
  const env: Record<string, string> = {};

  if (existsSync(envFile)) {
    Object.assign(env, parseEnvFile(readFileSync(envFile, "utf8")));
    loadedFiles.push(envFile);
  }

  if (existsSync(localEnvFile)) {
    Object.assign(env, parseEnvFile(readFileSync(localEnvFile, "utf8")));
    loadedFiles.unshift(localEnvFile);
  }

  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  return { env: { ...env }, loadedFiles };
}

export function parseEnvFile(contents: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const assignment = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trimStart()
      : trimmed;
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = assignment.slice(0, separatorIndex).trim();
    const rawValue = assignment.slice(separatorIndex + 1).trim();
    env[key] = unquoteEnvValue(rawValue);
  }

  return env;
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  const commentIndex = value.indexOf(" #");
  return commentIndex === -1 ? value : value.slice(0, commentIndex).trimEnd();
}
