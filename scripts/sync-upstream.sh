#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
upstream_ref="${UPSTREAM_REF:-main}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

upstream_dir="$tmp_dir/azure-skills"
git -C "$tmp_dir" init --quiet azure-skills
git -C "$upstream_dir" remote add origin \
  https://github.com/microsoft/azure-skills.git
git -C "$upstream_dir" fetch --quiet --depth 1 origin "$upstream_ref"
git -C "$upstream_dir" checkout --quiet --detach FETCH_HEAD

rsync -a --delete \
  "$upstream_dir/skills/microsoft-foundry/" \
  "$repo_root/upstream/microsoft-foundry/"

cp "$upstream_dir/LICENSE" "$repo_root/LICENSE"
node "$repo_root/scripts/build-skill.mjs"

commit="$(git -C "$upstream_dir" rev-parse HEAD)"
printf 'Synced microsoft/azure-skills@%s\n' "$commit"
