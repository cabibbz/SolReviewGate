#!/bin/sh
# One-command update for an existing Sol Review Gate installation.
#
#   sh -c "$(curl -fsSL 'https://raw.githubusercontent.com/cabibbz/SolReviewGate/main/update.sh')"
#
# Reads the PWA address and client token the installer already saved, then reinstalls the client
# and both skills from the repository's main branch. Nothing is prompted and nothing else changes.
# Set SOL_REPOSITORY_ROOT to update from a different branch, tag, or local checkout.
set -eu

source_root="${SOL_REPOSITORY_ROOT:-https://raw.githubusercontent.com/cabibbz/SolReviewGate/main}"
install_root="${SOL_INSTALL_ROOT:-$HOME/.sol-review}"
config_path="$install_root/remote.json"

if [ ! -f "$config_path" ]; then
  printf "No installed client was found at %s. Run the installer once first; updating needs its saved address and token.\n" "$config_path" >&2
  exit 1
fi

SOL_GATE_URL="$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").replace(/^﻿/,""));process.stdout.write(c.url||"")' "$config_path")"
SOL_GATE_CLIENT_TOKEN="$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").replace(/^﻿/,""));process.stdout.write(c.token||"")' "$config_path")"
if [ -z "$SOL_GATE_URL" ] || [ -z "$SOL_GATE_CLIENT_TOKEN" ]; then
  printf "The saved configuration at %s is missing its address or token. Run the installer once to recreate it.\n" "$config_path" >&2
  exit 1
fi

printf "Updating Sol Review Gate for %s\nSource: %s\n" "$SOL_GATE_URL" "$source_root"

export SOL_GATE_URL SOL_GATE_CLIENT_TOKEN
export SOL_REPOSITORY_ROOT="$source_root"

sh -c "$(curl -fsSL "$source_root/install.sh")"
