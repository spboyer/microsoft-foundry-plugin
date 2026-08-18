#!/usr/bin/env bash
# Recreate the Entra app registration backing the Cowork MCP connector.
#
# Only needed if the app has been deleted. If it still exists, do NOT run this --
# you will end up with a duplicate registration and a second consent problem.
# Check first:  az ad app show --id "$EXPECTED_APP_ID"
#
# The app is deliberately a secretless PKCE public client:
#   - registered as an SPA platform, which forces PKCE and forbids a secret
#   - tenant policy blocks client secrets anyway, so this is not a preference
#   - Cowork's Enterprise Token Store performs the code->token exchange, and the
#     redirect URI below is its fixed endpoint, not ours
#
# See docs/foundry/deployed-state.md for what the resulting IDs are used for.

set -euo pipefail

DISPLAY_NAME="Microsoft Foundry MCP for Cowork"
EXPECTED_APP_ID="eccfe193-2196-4444-9782-075a6c1c40fd"
REDIRECT_URI="https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect"

# Foundry MCP App and its single delegated scope, Foundry.Mcp.Tools
RESOURCE_APP_ID="fcdfa2de-b65b-4b54-9a1c-81c8a18282d9"
SCOPE_ID="5113a404-4d87-43b6-8d8c-819a39bef5ec"

if az ad app show --id "$EXPECTED_APP_ID" >/dev/null 2>&1; then
  echo "App $EXPECTED_APP_ID already exists. Nothing to do."
  echo "If you genuinely want a second registration, edit DISPLAY_NAME and remove this guard."
  exit 0
fi

echo "Creating app registration: $DISPLAY_NAME"
APP_ID=$(az ad app create \
  --display-name "$DISPLAY_NAME" \
  --sign-in-audience AzureADMyOrg \
  --enable-id-token-issuance false \
  --enable-access-token-issuance false \
  --query appId -o tsv)

echo "Created appId: $APP_ID"

# az ad app create has no --spa-redirect-uris flag, so patch the SPA platform via Graph.
OBJ_ID=$(az ad app show --id "$APP_ID" --query id -o tsv)
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$OBJ_ID" \
  --headers 'Content-Type=application/json' \
  --body "{\"spa\":{\"redirectUris\":[\"$REDIRECT_URI\"]}}"

echo "Set SPA redirect URI: $REDIRECT_URI"

az ad app permission add \
  --id "$APP_ID" \
  --api "$RESOURCE_APP_ID" \
  --api-permissions "$SCOPE_ID=Scope"

echo "Requested delegated scope Foundry.Mcp.Tools on $RESOURCE_APP_ID"
echo
echo "Done. appId = $APP_ID"
echo
echo "Next steps:"
echo "  1. Set FOUNDRY_MCP_CLIENT_ID=$APP_ID in env/.env.local"
echo "  2. Clear FOUNDRY_MCP_AUTH_ID so oauth/register mints a fresh vault record"
echo "  3. Re-provision"
echo
echo "This grants nothing. A tenant admin must still consent:"
echo "  az ad app permission admin-consent --id $APP_ID"
echo "Our tenant permits only low-impact self-consent, so a custom API scope will be"
echo "refused until an admin acts. See docs/cowork-mcp-connector-findings.md, Edge 6."
