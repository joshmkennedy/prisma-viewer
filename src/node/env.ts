import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type EnvLoadResult = {
  env: Record<string, string>;
  loadedFiles: string[];
};

export type EnvLoadOptions = {
  envFile?: string;
};

export function loadAppEnv(appRoot: string, options: EnvLoadOptions = {}): EnvLoadResult {
  const envFile = path.join(appRoot, ".env");
  const localEnvFile = path.join(appRoot, ".env.local");
  const loadedFiles: string[] = [];
  const env: Record<string, string> = {};

  loadEnvFile(envFile, env, loadedFiles);
  loadEnvFile(localEnvFile, env, loadedFiles);

  if (options.envFile) {
    loadEnvFile(options.envFile, env, loadedFiles);
  }

  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  return { env: { ...env }, loadedFiles };
}

function loadEnvFile(
  envFile: string,
  env: Record<string, string>,
  loadedFiles: string[],
) {
  if (!existsSync(envFile)) return;

  Object.assign(env, parseEnvFile(readFileSync(envFile, "utf8")));

  const existingIndex = loadedFiles.indexOf(envFile);
  if (existingIndex !== -1) {
    loadedFiles.splice(existingIndex, 1);
  }

  loadedFiles.unshift(envFile);
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
