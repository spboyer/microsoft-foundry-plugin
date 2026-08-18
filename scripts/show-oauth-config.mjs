#!/usr/bin/env node
// Reads (and optionally deletes) the deployed OAuth vault record backing the
// connector's `authorization.referenceId`.
//
// There is no supported CLI for this, which makes connector auth very hard to
// debug — you cannot otherwise answer "what OAuth config is actually live?".
// See docs/cowork-mcp-connector-findings.md (proposal P5).
//
// Usage:
//   node scripts/show-oauth-config.mjs [--env local] [--delete]
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ATK_CLIENT_ID = "7ea7c24c-b1f6-4a20-9d11-9ae12e9e7ac0";
const ATK_SCOPE = "https://teamsgraph.teams.microsoft.com/.default";
const VAULT = "https://teams.microsoft.com/api/platform/v1.0/oAuthConfigurations";
const CACHE = join(homedir(), ".fx/account/token.cache.appStudio.json");
const KEYCHAIN = { service: "Microsoft 365 Agents Toolkit", account: "appStudio" };

const args = process.argv.slice(2);
const envName = args.includes("--env") ? args[args.indexOf("--env") + 1] : "local";
const doDelete = args.includes("--delete");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// wiqd bundles both dependencies; resolve from there rather than adding deps here.
const wiqdModules = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const req = createRequire(join(wiqdModules, "@microsoft/wiqd/node_modules/index.js"));
const { PublicClientApplication } = req("@azure/msal-node");
const keytar = req("keytar");

function readEnv(name) {
  const file = join(repoRoot, "env", `.env.${envName}`);
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} not found in ${file}`);
  return line.slice(name.length + 1).trim();
}

// ATK stores its MSAL cache AES-256-GCM encrypted, keyed from the OS keychain.
// The cache file uses short hex-encoded fields: i = iv, c = ciphertext, t = auth tag.
// The keychain value is a raw 32-character string, used as the key verbatim.
async function decryptCache() {
  const key = await keytar.getPassword(KEYCHAIN.service, KEYCHAIN.account);
  if (!key) throw new Error("no ATK cache key in keychain — run `wiqd auth login --interactive`");
  const { i, c, t } = JSON.parse(readFileSync(CACHE, "utf8"));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "utf8"), Buffer.from(i, "hex"));
  decipher.setAuthTag(Buffer.from(t, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(c, "hex")), decipher.final()]).toString();
}

async function getToken() {
  const cache = await decryptCache();
  const pca = new PublicClientApplication({
    auth: { clientId: ATK_CLIENT_ID, authority: "https://login.microsoftonline.com/common" },
    cache: {
      cachePlugin: {
        beforeCacheAccess: async (ctx) => ctx.tokenCache.deserialize(cache),
        afterCacheAccess: async () => {},
      },
    },
  });
  const [account] = await pca.getTokenCache().getAllAccounts();
  if (!account) throw new Error("no cached ATK account — run `wiqd auth login --interactive`");
  const { accessToken } = await pca.acquireTokenSilent({ account, scopes: [ATK_SCOPE] });
  return accessToken;
}

const referenceId = readEnv("FOUNDRY_MCP_AUTH_ID");
const token = await getToken();
const headers = { Authorization: `Bearer ${token}`, "Client-Source": "agentstoolkit" };
const url = `${VAULT}/${encodeURIComponent(referenceId)}`;

if (doDelete) {
  const res = await fetch(url, { method: "DELETE", headers });
  // NOTE: DELETE returns 204 but an immediate GET still returns 200 — propagation lag.
  console.log(`DELETE ${res.status}`);
  process.exit(res.ok ? 0 : 1);
}

const res = await fetch(url, { headers });
console.log(`GET ${res.status}`);
const body = await res.text();
try {
  const record = JSON.parse(body);
  console.log(JSON.stringify(record, null, 2));
  console.log("\n--- checks ---");
  console.log(`identityProvider : ${record.identityProvider}`);
  console.log(`applicableToApps : ${record.applicableToApps ?? "(unset → AnyApp)"}`);
  console.log(`specificAppId    : ${record.specificAppId ?? record.appId ?? "(none)"}`);
  console.log(`scopes           : ${JSON.stringify(record.scopes)}`);
  console.log(`isPKCEEnabled    : ${record.isPKCEEnabled}`);
} catch {
  console.log(body);
}
