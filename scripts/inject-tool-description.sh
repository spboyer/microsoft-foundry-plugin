#!/usr/bin/env bash
# Adds the MCP tool-description file to the built app package.
#
# The Agents Toolkit packager (teamsApp/zipAppPackage) copies icons, the
# manifest, and agentSkills[].folder trees — it has no handling for
# agentConnectors[].toolSource.remoteMcpServer.mcpToolDescription.file, so the
# file has to be injected after packaging or Cowork cannot verify the connector.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${TEAMSFX_ENV:-local}"
ZIP="$ROOT/appPackage/build/appPackage.$ENV_NAME.zip"
REL_PATH="tools/foundry-mcp-tools.json"

command -v zip >/dev/null 2>&1 || { echo "error: 'zip' is required but not installed" >&2; exit 1; }
[ -f "$ZIP" ] || { echo "error: package not found: $ZIP" >&2; exit 1; }
[ -f "$ROOT/appPackage/$REL_PATH" ] || { echo "error: missing $REL_PATH" >&2; exit 1; }

(cd "$ROOT/appPackage" && zip -q "$ZIP" "$REL_PATH")

unzip -l "$ZIP" | grep -q "$REL_PATH" || { echo "error: injection failed" >&2; exit 1; }
echo "Injected $REL_PATH into $(basename "$ZIP")"
