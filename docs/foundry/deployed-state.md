# Deployed state — Microsoft Foundry plugin

Everything here is an **identifier**, not a credential. No secrets are recorded in this
folder, and none exist: the Entra app is a secretless PKCE public client.

The reason this file exists is that ATK keeps the deployed identifiers in
`env/.env.local`, which its own `.gitignore` excludes. That is the right default for a
throwaway local environment and the wrong one for a plugin that is actually published —
losing that file means hunting through the Teams Developer Portal and Entra to work out
which of several app IDs is the live one. This is the durable copy.

Captured 2026-08-18 against plugin version 1.0.6.

## Identifiers

| Name | Value | What it is |
|---|---|---|
| `TEAMS_APP_ID` | `93c43219-a28c-4809-a63b-308b5c97cc6a` | Created by `teamsApp/create`. Identifies the app in the Teams Developer Portal. |
| `M365_APP_ID` | `bd6f81c3-239c-449b-84c5-5bc568a33564` | Created by `copilotAgent/publish`. **This** is the ID Cowork resolves the connector's OAuth record under. |
| `M365_TITLE_ID` | `T_160c738d-0556-4974-5a83-9fc11aedd159` | Catalog title. Stays stable across version bumps — reuse it, don't mint a new one. |
| `TEAMS_APP_TENANT_ID` | `72f988bf-86f1-41af-91ab-2d7cd011db47` | microsoft.com corp tenant. |
| `FOUNDRY_MCP_CLIENT_ID` | `eccfe193-2196-4444-9782-075a6c1c40fd` | Our hand-registered Entra client. **Deleted 2026-08-19** — see below. Snapshot in `entra-app-registration.json`. |
| `FOUNDRY_MCP_AUTH_ID` | see `env/.env.local` | Vault record referenceId, regenerated on each `oauth/register`. Deliberately not pinned here — it changes. |

The two app IDs are the trap. They look interchangeable and are not: binding the OAuth
record to the Teams ID produces a connector that 404s at runtime with
`M365AppNotFoundError`. See Edge 4 in `../cowork-mcp-connector-findings.md`.

`FOUNDRY_MCP_AUTH_ID` is base64 of `<tenantId>##<configId>`, which is a quick way to
confirm which record a given plugin build is pointing at.

## Foundry MCP (the resource we authenticate against)

| Name | Value |
|---|---|
| Server URL | `https://mcp.ai.azure.com` |
| Resource app | `fcdfa2de-b65b-4b54-9a1c-81c8a18282d9` ("Foundry MCP App") |
| Scope | `Foundry.Mcp.Tools`, id `5113a404-4d87-43b6-8d8c-819a39bef5ec` |
| Resource home tenant | `f8cdef31-a31e-4b4a-93e4-5f571e91255a` (Microsoft first-party services) |

The resource app registration is not in our tenant — only its service principal is, so
`az ad app show` on it returns "does not exist" from a corp login. That is expected, and it
is why nobody on our side can add ourselves to its `preAuthorizedApplications`.

## Recovering if `env/.env.local` is lost

1. Recreate the file with `TEAMSFX_ENV=local` and `APP_NAME_SUFFIX=local`.
2. Copy the identifiers from the table above.
3. Leave `FOUNDRY_MCP_AUTH_ID` **empty** and re-run provision — `oauth/register` mints a
   fresh vault record. It will not rewrite an existing one, so a stale value here is worse
   than no value.
4. Confirm what actually landed with `node scripts/show-oauth-config.mjs --env local`,
   which should report `applicableToApps: AnyApp`.

Recreating the Entra app itself is only necessary if it has been deleted; see
`entra-app-registration.md`.

## The Entra app was deleted on 2026-08-19

Pending a decision on whether an author-owned client is the right approach at all — see
the Azure DevOps comparison in `../cowork-mcp-connector-findings.md` — the registration was
deleted rather than left sitting unused and unconsented.

**Restore it (preferred, within 30 days of 2026-08-19):**

```bash
az rest --method POST \
  --url "https://graph.microsoft.com/v1.0/directory/deletedItems/c9e35709-da01-46b9-9197-a85103cbd2fe/restore"
```

Restoring returns the **same `appId`**, so `env/.env.local`, the OAuth vault record and the
shipped manifest all keep working untouched. Check it is still restorable with:

```bash
az rest --method GET --url "https://graph.microsoft.com/v1.0/directory/deletedItems/microsoft.graph.application?\$filter=appId eq 'eccfe193-2196-4444-9782-075a6c1c40fd'"
```

**After 30 days** the object is purged and only `scripts/recreate-entra-app.sh` remains.
That mints a **new** `appId`, which then has to be written into `env/.env.local`, followed by
clearing `FOUNDRY_MCP_AUTH_ID` and re-provisioning so `oauth/register` mints a matching vault
record. Restoring is strictly less work — prefer it while the window is open.

Note the deployed plugin's connector is broken until one or the other happens: the vault
record still names a client that no longer exists. Nothing else about the package changed.

## What is *not* captured here

- The TDP vault OAuth record. It is server-side and opaque; treat it as regenerable rather
  than as state worth preserving.
- Admin consent. As of this writing it has not been granted, so the connector reaches the
  Entra consent page and stops. Nothing in this repo can change that.
