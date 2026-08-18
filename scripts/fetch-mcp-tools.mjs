#!/usr/bin/env node
// Regenerates appPackage/tools/foundry-mcp-tools.json from the live Foundry MCP
// server. Cowork requires a static tool description for remoteMcpServer
// connectors; it does not fall back to runtime tools/list discovery.
//
// Usage:
//   az login
//   node scripts/fetch-mcp-tools.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_URL = "https://mcp.ai.azure.com";
const SCOPE = "https://mcp.ai.azure.com/Foundry.Mcp.Tools";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../appPackage/tools/foundry-mcp-tools.json");

function getToken() {
  return execFileSync("az", ["account", "get-access-token", "--scope", SCOPE, "--query", "accessToken", "-o", "tsv"], {
    encoding: "utf8",
  }).trim();
}

function parseSse(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .flatMap((l) => {
      try {
        return [JSON.parse(l.slice(5).trim())];
      } catch {
        return [];
      }
    });
}

async function rpc(headers, body) {
  const res = await fetch(SERVER_URL, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${body.method} failed: HTTP ${res.status} ${await res.text()}`);
  return res;
}

const token = getToken();
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

const init = await rpc(headers, {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "microsoft-foundry-plugin", version: "1.0.0" },
  },
});
const sessionId = init.headers.get("mcp-session-id");
if (!sessionId) throw new Error("server did not return an mcp-session-id");
await init.text();

const sessionHeaders = { ...headers, "mcp-session-id": sessionId };
await rpc(sessionHeaders, { jsonrpc: "2.0", method: "notifications/initialized" });

const tools = [];
let cursor;
for (let page = 0; page < 50; page++) {
  const res = await rpc(sessionHeaders, {
    jsonrpc: "2.0",
    id: 100 + page,
    method: "tools/list",
    params: cursor ? { cursor } : {},
  });
  const result = parseSse(await res.text()).find((m) => m.result)?.result;
  if (!result) throw new Error("tools/list returned no result");
  tools.push(...(result.tools ?? []));
  if (!result.nextCursor) break;
  cursor = result.nextCursor;
}

const payload = {
  tools: tools
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${payload.tools.length} tools to ${OUT}`);
