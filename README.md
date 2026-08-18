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
  as Markdown references.

The initial import is pinned in [NOTICE.md](NOTICE.md). Upstream content remains
licensed under the MIT License included in [LICENSE](LICENSE).

The remote connector uses Microsoft Entra SSO with the first-party Foundry MCP
resource application and requests user authorization at runtime. Provisioning
creates the Enterprise token-store configuration referenced by the manifest;
no client secret is stored in this repository.

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
