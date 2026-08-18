# Cowork MCP connector — field notes

Working notes from building **Microsoft Foundry** (a private Copilot Cowork plugin that
wraps the `microsoft-foundry` skills plus the remote Foundry MCP server at
`https://mcp.ai.azure.com`) with `wiqd` Path B.

Audience: other plugin authors hitting the same walls, and the wiqd team.

**Status:** living document. Update it as new edges are found.

Last updated: 2026-08-18 — plugin v1.0.5.

---

## TL;DR for plugin authors

If you are shipping a `remoteMcpServer` connector to Cowork, budget for these five
things. None of them are automated by any tool today.

1. **You must ship a static `mcpToolDescription` file.** Dynamic `tools/list` discovery
   is *not* sufficient for Cowork, even on manifest 1.29 where the field is schema-optional.
2. **The `file` path must not start with `./`** — despite Microsoft's own docs using `./`.
3. **The toolchain will not put that file in the ZIP.** You have to inject it yourself.
4. **You must hand-author OAuth.** `wiqd plugin add connector` has no auth flags at all.
5. **Entra SSO is the wrong OAuth mode** for an external protected resource. You need
   static OAuth (`identityProvider: Custom`).

---

## Edge 1 — `mcpToolDescription` is effectively required in Cowork

### What the docs say

Two Microsoft docs disagree, and the disagreement is load-bearing.

| Source | Claim |
| --- | --- |
| Teams manifest **1.29** JSON schema | `mcpToolDescription` is optional (`required: ["mcpServerUrl"]`) |
| wiqd [plugin reference](https://microsoft.github.io/wiqd/getting-started/plugin-reference/) | "at **1.29**, `agentConnectors[]` entries are **URL-only** and `mcpToolDescription` becomes optional… Authoring against wiqd's pinned 1.29 schema sidesteps that failure mode entirely" |
| Learn — [Build plugins for Copilot Cowork](https://learn.microsoft.com/en-us/microsoft-365/copilot/cowork/cowork-plugin-development) | Connector validation: "`mcpToolDescription` required on each `remoteMcpServer`, with a `file` that exists in the ZIP — **Error**" |

### What actually happens

Omitting `mcpToolDescription` on manifest 1.29:

- `wiqd plugin validate` — passes
- `wiqd plugin validate --mode deep` — passes, **0 errors, 0 warnings**
- `wiqd plugin provision` / upload — succeeds
- Cowork **Sources & Skills → Plugins** — connector shows a red
  **"Could not verify connection. Try again."**

So the failure surfaces only in the Cowork product UI, after a clean deploy. Nothing in
the authoring or validation loop warns you.

The Cowork doc's connector requirements table lists tool discovery as
"Support `tools/list` for dynamic discovery (**recommended**)", which reads as though
runtime discovery is enough. It isn't — the validation-rules table later in the same page
is the operative one. Even the Dynamic Client Registration section says
"You can omit the `authorization` object, but `mcpToolDescription` is still required."

### Ruling out the server

Before blaming the manifest we proved the server itself was healthy:

```bash
# 1. Unauthenticated probe — confirms the URL and the auth challenge
curl -s -D- -o/dev/null -X POST https://mcp.ai.azure.com \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# → HTTP 401
# → www-authenticate: McpAuth, resource_metadata="https://mcp.ai.azure.com/.well-known/oauth-protected-resource"

# 2. Authenticated handshake with a real delegated token
az account get-access-token --scope https://mcp.ai.azure.com/Foundry.Mcp.Tools
# → HTTP 200, mcp-session-id header, protocolVersion 2025-06-18, 79 tools from tools/list
```

Note the URL is the bare root — no `/mcp` or `/sse` path, despite wiqd's generic docs
example using `https://<mcp-server>/mcp`.

**Lesson:** a working `initialize` + `tools/list` from curl tells you nothing about whether
Cowork will verify the connector. Don't stop there.

### The fix

```jsonc
"remoteMcpServer": {
  "mcpServerUrl": "https://mcp.ai.azure.com",
  "mcpToolDescription": { "file": "tools/foundry-mcp-tools.json" },
  "authorization": { "type": "OAuthPluginVault", "referenceId": "${{FOUNDRY_MCP_AUTH_ID}}" }
}
```

The file's contents are the `tools/list` result verbatim — `{ "tools": [ … ] }`, each entry
carrying `name`, `description`, `inputSchema`, and (where the server supplies them)
`annotations`. See `scripts/fetch-mcp-tools.mjs` in this repo, which regenerates the file
from the live server so it can never drift by hand.

---

## Edge 2 — a leading `./` in `mcpToolDescription.file` fails validation

Microsoft's Cowork doc shows this, twice:

```json
"mcpToolDescription": { "file": "./tools/contoso-legal-tools.json" }
```

With the file genuinely present in the ZIP at `tools/foundry-mcp-tools.json`, deep
validation rejected it:

```
(×) Error: InvalidAgentConnector: The agent connector with ID microsoft-foundry-mcp
    has its declared MCP tool description file ./tools/foundry-mcp-tools.json
    not found in the app package.
```

Dropping the `./` — `"file": "tools/foundry-mcp-tools.json"` — passes immediately
(56 passed, 0 errors). The validator appears to do a literal string match against ZIP
entry names, which are stored without a `./` prefix.

The manifest schema is no help: `relativePath` is defined as nothing more than
`{ "type": "string", "maxLength": 2048 }`.

**Doc bug.** The Learn examples should not use `./`.

---

## Edge 3 — the packager never adds the tool-description file to the ZIP

`wiqd plugin package` delegates to the Agents Toolkit `teamsApp/zipAppPackage` action.
That packager copies:

- `manifest.json`
- `color.png` / `outline.png`
- every `agentSkills[].folder` tree (`createAppPackage.js` → `addAgentSkillFolders`)
- API-plugin / OpenAPI files, when present

It has **no** handling for
`agentConnectors[].toolSource.remoteMcpServer.mcpToolDescription.file`:

```bash
grep -rn "agentSkills\|mcpToolDescription" .../driver/teamsApp/*.js
# → six hits for agentSkills, zero for mcpToolDescription
```

So you can declare the file correctly, have it sitting in `appPackage/tools/`, and still
ship a ZIP without it. The resulting `InvalidAgentConnector` error is at least loud — but
only because we'd already added the manifest field. With the field omitted (Edge 1) the
whole thing is silent.

### Workaround used here

`scripts/inject-tool-description.sh`, wired into **both** `m365agents.yml` and
`m365agents.local.yml` as a `script` action placed between `teamsApp/zipAppPackage` and
`teamsApp/validateAppPackage`:

```yaml
  # ATK's packager does not copy mcpToolDescription.file; inject it manually.
  - uses: script
    with:
      run: bash ./scripts/inject-tool-description.sh
      workingDirectory: .
```

Ordering matters — it has to land after the ZIP is built and before validation, or
`provision` fails on its own validation step.

Note this workaround shells out to `zip`, so it is POSIX-only as written.

---

## Edge 4 — connector authentication is entirely un-automated

`wiqd plugin add connector` accepts exactly three options:

```
--name  --description  --url
```

No auth flags. wiqd's own reference is upfront about it:

> `wiqd plugin add connector` is **URL-only** today and does not scaffold connector
> authentication — if your MCP server or API plugin needs auth, configure it directly per
> the M365 Copilot extensibility documentation; wiqd doesn't yet automate that step.

That is honest, but it collides with wiqd's own anti-pattern guidance in
`workflows/plugin.md` ("don't hand-author manifest files"). For any authenticated
connector there is currently no other option.

Everything below had to be assembled from Microsoft Learn plus the Work IQ
`declarative-agent-developer/references/authentication.md` reference — none of it is in
wiqd's bundled docs.

### Entra SSO is *not* the right mode

The first attempt used `identityProvider: MicrosoftEntra` with `useSingleSignOn: true`.
It validated, provisioned, and produced a vault record that looked plausible — but was
structurally incapable of working:

```jsonc
{
  "identityProvider": "MicrosoftEntra",
  "useSingleSignOn": true,
  "scopes": null,                                            // ← no scope, ever
  "resourceIdentifierUri": "api://auth-…/fcdfa2de-…"          // ← the plugin's OWN api
}
```

Entra SSO mode configures the plugin as *its own* protected API. It cannot request a
delegated scope from a **third-party** protected resource such as
`https://mcp.ai.azure.com/Foundry.Mcp.Tools`. The giveaway is `scopes: null`.

### Static OAuth + PKCE is

```yaml
  - uses: oauth/register
    with:
      name: microsoft-foundry-mcp
      appId: ${{TEAMS_APP_ID}}
      flow: authorizationCode
      identityProvider: Custom
      baseUrl: https://mcp.ai.azure.com
      clientId: ${{FOUNDRY_MCP_CLIENT_ID}}
      authorizationUrl: https://login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize
      tokenUrl:         https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
      refreshUrl:       https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
      scope: https://mcp.ai.azure.com/Foundry.Mcp.Tools,offline_access
      isPKCEEnabled: true
      tokenExchangeMethodType: PostRequestBody
      applicableToApps: SpecificApp
      targetAudience: HomeTenant
    writeToEnvironmentFile:
      configurationId: FOUNDRY_MCP_AUTH_ID
```

Gotchas in this block:

- `scope` is **comma-separated** in YAML; the vault stores it as an array.
- A bare `scope:` is YAML `null` and fails schema validation — quote it (`""`) if empty.
- The authoritative field list is the ATK YAML schema
  (`m365agentstoolkit-cli/resource/yaml-schema/yaml.schema.json`, `definitions.oauthRegister`),
  **not** the docs. Only `name` and `flow` are actually required.

### The Entra app registration

- Single-tenant
- Redirect URI (**SPA** platform): `https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect`
- Delegated permission: `Foundry.Mcp.Tools` on the Foundry MCP resource
- **No client secret** — PKCE public client

Two tenant policies shaped this and will shape yours:

- App creation requires a `serviceManagementReference`.
- A credential policy forbids client secrets outright.

Hence PKCE, not a confidential client. Note that Learn frames static OAuth registration
as taking a client ID *and* a secret, with PKCE as an optional hardening step rather than
a secret replacement — whether the Enterprise Token Store can complete a code→token
exchange for a secretless public client is **not documented**, and is still an open
question here.

### Reading back what actually got deployed

There is no CLI for this, which makes the whole loop hard to debug. What works:

```
GET    https://teams.microsoft.com/api/platform/v1.0/oAuthConfigurations/<referenceId>
DELETE https://teams.microsoft.com/api/platform/v1.0/oAuthConfigurations/<referenceId>
Header: Client-Source: agentstoolkit
```

Authenticate with the ATK token cache (`~/.fx/account/token.cache.appStudio.json`,
AES-256-GCM, key in the macOS keychain under `Microsoft 365 Agents Toolkit` / `appStudio`),
client `7ea7c24c-b1f6-4a20-9d11-9ae12e9e7ac0`, scope
`https://teamsgraph.teams.microsoft.com/.default`.

**Quirk:** `DELETE` returns `204`, but an immediate `GET` still returns `200`. Propagation
lag — re-check after a few seconds for the `404`.

---

## Edge 5 — smaller things worth knowing

- **`targetAudience`.** Learn says: "When registering your OAuth client, set the usage by
  organization to **Any Microsoft 365 Organization** to ensure your plugin works across
  tenants." For a private single-tenant plugin backed by a single-tenant Entra app,
  `HomeTenant` is the consistent choice — but if you see tenant-resolution failures, this
  is the first knob to try.
- **Provision order.** `provision` → `package` → `share`. `provision` is the only command
  that writes `env/.env.<env>`, and it re-runs the whole lifecycle (including packaging and
  validation), so any post-package step must live inside the YAML, not beside it.
- **`--verbose` is mandatory for diagnosis.** Without it, deep validation collapses the
  real ATK error into a truncated `TDP-F…` row. `wiqd plugin validate --mode deep --verbose`
  surfaced the actual `InvalidAgentConnector` message.
- **Companion-file limits appear unenforced.** The docs cap a skill at 20 companion files;
  this package ships ~189 under one skill and passes deep validation. Don't rely on that.
- **Persistent benign warnings** for this package: `ShortNameContainsMicrosoft` (intentional
  — the plugin *is* Microsoft Foundry) and privacy/terms URLs on a different domain from the
  website URL.

---

## Proposed changes to wiqd

Ordered by how much pain each removes.

### P1 — package `mcpToolDescription.file` into the ZIP

The single highest-value fix. wiqd already owns the packaging step; it should read
`agentConnectors[].toolSource.remoteMcpServer.mcpToolDescription.file` from the manifest
and add it to the archive, exactly as it already does for `agentSkills[].folder`.

Without this, *every* authenticated Cowork connector author writes the same
post-package injection hack.

### P2 — validate connector completeness for the Cowork target

`wiqd plugin validate` should error (or at minimum warn loudly) when a `remoteMcpServer`
connector has no `mcpToolDescription`, since the Cowork platform treats it as required
regardless of what the 1.29 schema permits.

Today the failure is invisible until the connector fails to verify inside the Cowork UI —
the worst possible place to discover it. wiqd's plugin reference currently states the
opposite ("URL-only… sidesteps that failure mode entirely"), which actively leads authors
into this trap; that paragraph should be corrected.

Related: normalize or reject a leading `./` in `mcpToolDescription.file` rather than
letting it fail deep validation with a confusing "not found in the app package" message.

### P3 — generate the tool description from the live server

A command such as:

```
wiqd plugin add connector --url https://mcp.ai.azure.com --fetch-tools
```

…that performs the MCP handshake (`initialize` → `notifications/initialized` →
paginated `tools/list`), writes `appPackage/tools/<id>-tools.json`, and sets
`mcpToolDescription.file` in one step. Every author of an authenticated connector needs
this and will otherwise write it themselves — this repo's
`scripts/fetch-mcp-tools.mjs` is that script.

A companion `wiqd plugin connector refresh` would keep the file in sync as the upstream
server's tool surface changes. Right now a server-side tool addition silently makes your
shipped description stale.

### P4 — first-class connector authentication

`wiqd plugin add connector` should grow auth support, e.g.:

```
wiqd plugin add connector \
  --url https://mcp.ai.azure.com \
  --auth oauth \
  --client-id <id> \
  --scope https://mcp.ai.azure.com/Foundry.Mcp.Tools \
  --pkce
```

…emitting the `oauth/register` block into both lifecycle YAML files and the
`authorization` object into the manifest. This is currently the largest hand-authoring
surface in the whole workflow, and it directly contradicts wiqd's own
"don't hand-author manifests" guidance.

Minimum viable version: document the `oauth/register` block in wiqd's connector docs and
link the Learn authentication page from `wiqd plugin add connector --help`.

### P5 — inspect and diff deployed OAuth vault records

```
wiqd plugin auth show [--env local]
```

…printing the deployed `oAuthConfigurations` record for the connector's `referenceId`.
Diagnosing Edge 4 required reverse-engineering the ATK token cache and hand-rolling an
MSAL client just to read back what had been deployed. Authors cannot currently answer the
basic question *"what OAuth config is actually live right now?"* with any supported tool.

A `--diff` mode against the local `oauth/register` block would immediately surface the
`scopes: null` symptom that made the Entra-SSO misconfiguration so hard to spot.

### P6 — surface real errors without `--verbose`

Deep validation should print the underlying ATK error text by default. The truncated
`TDP-F… AppStudioPlugin.ManifestValidationFailed` row is not actionable; the message
behind it (`InvalidAgentConnector: … not found in the app package`) is immediately
actionable.

### P7 — cross-platform post-package hooks

If P1 is not adopted, wiqd should at least offer a documented, cross-platform
`postPackage` hook so authors aren't shelling out to `zip` (POSIX-only) or
`Compress-Archive` (which cannot append) from a raw `script` action.

---

## Open questions

- Does the Enterprise Token Store support a **secretless PKCE public client** for static
  OAuth, or does it require a confidential client with a secret? Learn is ambiguous and
  tenant policy here forbids secrets.
- Does the Foundry MCP server advertise a `registration_endpoint` (RFC 7591)? If so,
  `DynamicClientRegistration` would sidestep the client-secret question entirely. Entra
  generally does not support DCR, so this is likely a dead end.
- Is `mcpToolDescription` genuinely what Cowork's connector health check consumes, or is it
  only one of several preconditions? To be confirmed once v1.0.5 is retried in the UI.

---

## Verification checklist

For anyone reproducing this setup:

- [ ] Server answers an unauthenticated `initialize` with `401` + a `McpAuth` challenge
- [ ] Server answers an authenticated `initialize` with `200` + an `mcp-session-id`
- [ ] `tools/list` returns the expected tools with a real delegated token
- [ ] `appPackage/tools/<name>.json` exists and matches the live `tools/list`
- [ ] `mcpToolDescription.file` has **no** `./` prefix
- [ ] `unzip -l` on the built package shows the tools file
- [ ] `wiqd plugin validate --mode deep --verbose` → 0 errors
- [ ] Deployed vault record shows `identityProvider: Custom`, a non-null `scopes`, and `isPKCEEnabled: true`
- [ ] Cowork → Sources & Skills → Plugins → connector verifies without error

---

## Timeline

| Version | Change | Outcome |
| --- | --- | --- |
| 1.0.2 | Added Entra SSO auth (`identityProvider: MicrosoftEntra`) | Connector failed to verify; vault record had `scopes: null` |
| 1.0.3 | Rewrote skill instructions for Cowork (use bundled connector, not local Azure MCP) | Skill loaded; connector still failed |
| 1.0.4 | Migrated to static OAuth + PKCE (`identityProvider: Custom`) | Vault record correct; connector still failed |
| 1.0.5 | Added `mcpToolDescription` + ZIP injection step | Deep validation clean; **pending Cowork retry** |
