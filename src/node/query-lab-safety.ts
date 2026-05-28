export const QUERY_LAB_SAFETY_LIMITS = {
  maxArgsDepth: 8,
  timeoutMs: 5_000,
  maxResponseBytes: 256 * 1024,
} as const;

export type QueryLabSafetyLimits = typeof QUERY_LAB_SAFETY_LIMITS;

export type SerializedPayloadSize =
  | { bytes: number; json: string }
  | { error: string };

export class QueryLabTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Query Lab safety limit exceeded: query did not finish within ${timeoutMs} ms.`,
    );
    this.name = "QueryLabTimeoutError";
  }
}

export function validateQueryLabArgsDepth(
  value: unknown,
  maxDepth = QUERY_LAB_SAFETY_LIMITS.maxArgsDepth,
): { depth: number } | { error: string; depth: number } {
  const depth = getNestedDepth(value);
  if (depth > maxDepth) {
    return {
      depth,
      error: `Query Lab safety limit exceeded: args nesting depth ${depth} exceeds the maximum of ${maxDepth}.`,
    };
  }

  return { depth };
}

export function measureSerializedPayload(value: unknown): SerializedPayloadSize {
  try {
    const json = JSON.stringify(value);
    return {
      json,
      bytes: Buffer.byteLength(json, "utf8"),
    };
  } catch {
    return {
      error: "Query Lab could not serialize the preview result.",
    };
  }
}

export async function withQueryLabTimeout<T>(
  promise: Promise<T>,
  timeoutMs = QUERY_LAB_SAFETY_LIMITS.timeoutMs,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new QueryLabTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function getNestedDepth(value: unknown): number {
  if (value instanceof Date) return 0;
  if (Array.isArray(value)) {
    if (value.length === 0) return 1;
    return 1 + Math.max(...value.map(getNestedDepth));
  }
  if (isRecord(value)) {
    const values = Object.values(value);
    if (values.length === 0) return 1;
    return 1 + Math.max(...values.map(getNestedDepth));
  }

  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
