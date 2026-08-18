# `docs/foundry/`

Durable record of the deployed plugin's identity and configuration.

This exists because the pieces that took longest to get right are the ones git does not
track by default. `appPackage/manifest.json` and the `m365agents*.yml` files are versioned
normally, but the identifiers they resolve to at provision time live in `env/.env.local`,
which ATK gitignores, and the Entra app registration lives only in Entra.

| File | Contents |
|---|---|
| `deployed-state.md` | Every deployed identifier, what it means, and how to recover if `env/.env.local` is lost |
| `entra-app-registration.json` | Sanitized snapshot of the Entra app (identifiers only; the app has no credentials) |
| `manifest.1.0.6.json` | The manifest exactly as it shipped, with `${{...}}` placeholders already resolved |

Related, one level up: `../cowork-mcp-connector-findings.md` is the running write-up of
every sharp edge hit while getting this working — the *why* behind the configuration
choices recorded here. Read that first if something looks arbitrary.

To recreate the Entra app after deletion: `scripts/recreate-entra-app.sh` (guarded, so it
is a no-op if the app still exists).

## Keeping this current

Refresh after any provision that changes identifiers — a new environment, a regenerated
OAuth record, or a new app registration. A version bump alone does not require an update,
since `M365_TITLE_ID` and both app IDs are stable across bumps.
