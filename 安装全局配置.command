#!/bin/sh
profile_source=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/sh "$profile_source/scripts/launch-global-profile.sh" "$@"
