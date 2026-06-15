import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export function extractTextContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((item): item is { type: string; text?: string } => typeof item === "object" && item !== null && "type" in item && item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

export function parseJsonMaybe<T>(text: string): T | string {
  try {
    return JSON.parse(text) as T;
  } catch {
    return text;
  }
}

export async function callTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = extractTextContent(result as Parameters<typeof extractTextContent>[0]);
  const parsed = parseJsonMaybe<T>(text);
  if (typeof parsed === "string") {
    return parsed as T;
  }
  return parsed as T;
}

export function pickFirstText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidateKeys = [
      "text",
      "texte",
      "content",
      "texteExtrait",
      "extractedText",
      "result",
      "data",
    ];
    for (const key of candidateKeys) {
      const candidate = record[key];
      if (typeof candidate === "string") {
        return candidate;
      }
    }

    const nested = (record as { content?: unknown }).content;
    if (Array.isArray(nested)) {
      for (const item of nested) {
        if (typeof item === "object" && item !== null) {
          const nestedRecord = item as Record<string, unknown>;
          const candidate = nestedRecord.text ?? nestedRecord.content ?? nestedRecord.data;
          if (typeof candidate === "string") {
            return candidate;
          }
        }
      }
    }
  }
  return undefined;
}

export function pickNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidateKeys = ["confidence", "score", "scoreConfiance"];
    for (const key of candidateKeys) {
      const candidate = record[key];
      if (typeof candidate === "number") {
        return candidate;
      }
    }
  }
  return undefined;
}

export function asArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value as Array<Record<string, unknown>>;
  }
  return [];
}

export function getProp<T extends string>(
  value: unknown,
  ...keys: T[]
): (string | undefined) | (number | undefined) | (Record<string, unknown> | undefined) | unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

export function firstProp(value: unknown, ...keys: string[]): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return undefined;
}
