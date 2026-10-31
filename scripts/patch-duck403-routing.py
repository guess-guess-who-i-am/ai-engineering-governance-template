#!/usr/bin/env python3
"""Stop Duck HTTP 403 from activating private provider failover."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile


MARKER = "DUCK_403_TERMINAL_V1"
ANCHOR = "            provider_error = retryable_provider_http_error(response)\n"
GUARD = (
    "            # DUCK_403_TERMINAL_V1: preserve refusals instead of changing providers.\n"
    "            if kind == \"private\" and current_route == \"duckduckport\" and response.status_code == 403:\n"
    "                sys.stderr.write(\"private fallback suppressed: route=duckduckport status=403\\n\")\n"
    "                return response, current_route\n"
)


def patch_source(source):
    if MARKER in source:
        if source.count(GUARD + ANCHOR) != 1:
            raise RuntimeError("existing terminal-403 guard differs; inspect before applying")
        return source, False
    if source.count(ANCHOR) != 1:
        raise RuntimeError("fallback anchor is missing or ambiguous; no file changed")
    patched = source.replace(ANCHOR, GUARD + ANCHOR, 1)
    compile(patched, "router.py", "exec")
    return patched, True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--router", type=Path, required=True)
    parser.add_argument("--expected-sha256")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    path = args.router.resolve(strict=True)
    original = path.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    if args.expected_sha256 and digest != args.expected_sha256:
        raise RuntimeError("router changed since inspection; refusing to overwrite")
    patched, changed = patch_source(original.decode("utf-8"))
    backup = None
    if changed and not args.dry_run:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = path.with_name(path.name + ".bak-duck403-" + stamp)
        shutil.copy2(path, backup)
        os.chmod(backup, 0o600)
        fd, staging = tempfile.mkstemp(prefix=".router-duck403-", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
                output.write(patched)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(staging, stat.S_IMODE(path.stat().st_mode))
            # Detect another editor before the atomic replacement as well.
            if path.read_bytes() != original:
                raise RuntimeError("router changed during patch; refusing to overwrite")
            os.replace(staging, path)
        finally:
            if os.path.exists(staging):
                os.unlink(staging)
    print(json.dumps({"status": "dry-run" if args.dry_run else "patched" if changed else "already-current", "changed": changed, "source_sha256": digest, "result_sha256": hashlib.sha256(patched.encode()).hexdigest(), "backup": str(backup) if backup else None}))


if __name__ == "__main__":
    main()
