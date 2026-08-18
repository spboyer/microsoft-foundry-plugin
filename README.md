# Microsoft Foundry

A focused Microsoft 365 Copilot plugin containing only the
`microsoft-foundry` skills from
[`microsoft/azure-skills`](https://github.com/microsoft/azure-skills), plus the
official remote Microsoft Foundry MCP connector at `https://mcp.ai.azure.com`.

## Contents

- `upstream/microsoft-foundry/` - the complete upstream Foundry skill subtree,
  including model deployment, agents, evaluation, fine-tuning, quota, RBAC,
  networking, and troubleshooting workflows.
- `appPackage/skills/microsoft-foundry/` - the generated Microsoft 365
  Copilot-compatible projection of the upstream skill.
- `appPackage/manifest.json` - registers the Foundry skills and remote MCP
  connector.
- `scripts/sync-upstream.sh` - refreshes only the Foundry subtree from upstream.
- `scripts/build-skill.mjs` - generates the package projection by renaming
  nested skill entry points, flattening paths deeper than three directories,
  rewriting Markdown links, and wrapping unsupported PowerShell and Bicep files
  as Markdown references. It also adapts local-only prerequisites so Cowork
  invokes the bundled Foundry MCP connector directly.
- `appPackage/tools/foundry-mcp-tools.json` - the connector's static tool
  description, referenced by `mcpToolDescription`. Cowork requires this file;
  it does not fall back to runtime `tools/list` discovery.
- `scripts/fetch-mcp-tools.mjs` - regenerates that file from the live MCP
  server (`az login` first).
- `scripts/inject-tool-description.sh` - adds the tool description to the built
  `.zip`. The Agents Toolkit packager does not copy `mcpToolDescription.file`,
  so this runs as a lifecycle `script` step after packaging.
- `scripts/show-oauth-config.mjs` - reads (or deletes) the deployed OAuth vault
  record backing the connector, since no supported CLI exposes it.
- `scripts/recreate-entra-app.sh` - recreates the Entra app registration if it is
  ever deleted. Guarded, so it no-ops while the app still exists.
- `docs/cowork-mcp-connector-findings.md` - the sharp edges found while wiring
  an authenticated MCP connector into Cowork, plus proposed wiqd improvements.
- `docs/foundry/` - durable record of the deployed identifiers and Entra app
  config, which otherwise live only in gitignored `env/.env.local` and in Entra.

The initial import is pinned in [NOTICE.md](NOTICE.md). Upstream content remains
licensed under the MIT License included in [LICENSE](LICENSE).

The remote connector uses Microsoft Entra authorization code flow with PKCE.
Its single-tenant public client requests the delegated
`https://mcp.ai.azure.com/Foundry.Mcp.Tools` scope and uses the Microsoft Teams
OAuth redirect URI. Provisioning creates the Enterprise token-store
configuration referenced by the manifest; no client secret or callback server
is required. The registration uses `applicableToApps: AnyApp` because Cowork
resolves the connector's `referenceId` under the M365 app ID rather than the
Teams app ID.

## Update from upstream

```bash
./scripts/sync-upstream.sh
```

Set `UPSTREAM_REF` to sync a specific branch, tag, or commit:

```bash
UPSTREAM_REF=<git-ref> ./scripts/sync-upstream.sh
```

Review the resulting diff before committing.

To rebuild the package projection without fetching upstream:

```bash
node scripts/build-skill.mjs
```

## Validate and preview

```bash
wiqd plugin validate
wiqd plugin provision --env local
wiqd plugin package --env local
wiqd plugin validate --mode deep --env local
```

Publishing and sharing are intentionally performed through the wiqd agentic
workflow after validation.
