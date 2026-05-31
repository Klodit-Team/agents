import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

export type McpConnection = {
  client: Client;
  transport: StdioClientTransport;
  close: () => Promise<void>;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function parseArgs(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as string[];
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

function parseEnvJson(raw?: string): Record<string, string> | undefined {
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw) as Record<string, string>;
}

export async function connectMcp(prefix: string): Promise<McpConnection> {
  const command = requireEnv(`${prefix}_COMMAND`);
  const args = parseArgs(process.env[`${prefix}_ARGS`]);
  const cwd = process.env[`${prefix}_CWD`];
  const envExtra = parseEnvJson(process.env[`${prefix}_ENV_JSON`]);

  const env = envExtra
    ? { ...getDefaultEnvironment(), ...envExtra }
    : undefined;

  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
    env,
    stderr: "inherit",
  });

  const client = new Client({
    name: `agent-${prefix.toLowerCase()}`,
    version: "0.1.0",
  });

  await client.connect(transport);

  return {
    client,
    transport,
    close: async () => {
      await transport.close();
    },
  };
}

export async function closeAll(connections: McpConnection[]) {
  await Promise.all(connections.map((conn) => conn.close()));
}
