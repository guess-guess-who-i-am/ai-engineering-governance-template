#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$repo_root/Deploy Codex Profile.app/Contents/MacOS/deploy" --repo "$repo_root" "$@"
