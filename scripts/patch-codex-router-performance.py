#!/usr/bin/env python3
import argparse
import json
import os
import py_compile
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path


MARKER = "PRIVATE_BALANCED_ROUTES_V1"


def replace_once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    return source.replace(old, new, 1)


def update_env(source, key, value):
    lines = source.splitlines()
    target = f"{key}={value}"
    found = False
    output = []
    for line in lines:
        if line.split("=", 1)[0].strip() == key:
            output.append(target)
            found = True
        else:
            output.append(line)
    if not found:
        output.append(target)
    return "\n".join(output) + "\n"


def patch_router(source):
    if MARKER in source:
        return source, False

    source = replace_once(
        source,
        '        self.private_default_route = os.environ.get("PRIVATE_DEFAULT_ROUTE", "").strip()\n',
        '        self.private_default_route = os.environ.get("PRIVATE_DEFAULT_ROUTE", "").strip()\n'
        '        # PRIVATE_BALANCED_ROUTES_V1: distribute private requests across equivalent routes.\n'
        '        self.private_balanced_routes = parse_fallback_routes(\n'
        '            os.environ.get("PRIVATE_BALANCED_ROUTES"),\n'
        '            default=[self.private_default_route] if self.private_default_route else [],\n'
        '        )\n',
        "balanced route config",
    )

    source = replace_once(
        source,
        '        if (\n'
        '            self.private_allowed_routes\n'
        '            and self.private_default_route\n'
        '            and self.private_default_route not in self.private_allowed_routes\n'
        '        ):\n',
        '        unknown_balanced_routes = [\n'
        '            route for route in self.private_balanced_routes if route not in self.routes\n'
        '        ]\n'
        '        if unknown_balanced_routes:\n'
        '            raise RuntimeError(\n'
        '                "PRIVATE_BALANCED_ROUTES contains unknown routes: "\n'
        '                + ", ".join(unknown_balanced_routes)\n'
        '            )\n'
        '        disallowed_balanced_routes = [\n'
        '            route for route in self.private_balanced_routes\n'
        '            if route not in self.private_allowed_routes\n'
        '        ]\n'
        '        if disallowed_balanced_routes:\n'
        '            raise RuntimeError(\n'
        '                "PRIVATE_BALANCED_ROUTES contains routes outside PRIVATE_ALLOWED_ROUTES: "\n'
        '                + ", ".join(disallowed_balanced_routes)\n'
        '            )\n'
        '        if (\n'
        '            self.private_allowed_routes\n'
        '            and self.private_default_route\n'
        '            and self.private_default_route not in self.private_allowed_routes\n'
        '        ):\n',
        "balanced route validation",
    )

    source = replace_once(
        source,
        '    def select_route(self, kind, payload, path):\n',
        '    def acquire_private_route(self):\n'
        '        route = self.server.acquire_private_route()\n'
        '        self._balanced_private_route = route\n'
        '        return route\n\n'
        '    def select_route(self, kind, payload, path):\n',
        "handler route acquisition",
    )

    old_default = (
        '            if self.cfg.private_default_route:\n'
        '                route = self.cfg.private_default_route\n'
        '                if route not in self.cfg.routes:\n'
        '                    raise ValueError("PRIVATE_DEFAULT_ROUTE is invalid")\n'
        '                return route, None\n'
    )
    new_default = (
        '            if self.cfg.private_default_route:\n'
        '                route = self.acquire_private_route()\n'
        '                if route not in self.cfg.routes:\n'
        '                    raise ValueError("PRIVATE_DEFAULT_ROUTE is invalid")\n'
        '                return route, None\n'
    )
    source = replace_once(source, old_default, new_default, "route selection without model")

    old_model = (
        '        if self.cfg.private_default_route:\n'
        '            route = self.cfg.private_default_route\n'
        '            if route not in self.cfg.routes:\n'
        '                raise ValueError("PRIVATE_DEFAULT_ROUTE is invalid")\n'
        '            return route, bare_model\n'
    )
    new_model = (
        '        if self.cfg.private_default_route:\n'
        '            route = self.acquire_private_route()\n'
        '            if route not in self.cfg.routes:\n'
        '                raise ValueError("PRIVATE_DEFAULT_ROUTE is invalid")\n'
        '            return route, bare_model\n'
    )
    source = replace_once(source, old_model, new_model, "route selection with model")

    source = replace_once(
        source,
        '    def proxy_request(self):\n'
        '        parsed = urlsplit(self.path)\n',
        '    def proxy_request(self):\n'
        '        request_started = time.monotonic()\n'
        '        self._balanced_private_route = ""\n'
        '        parsed = urlsplit(self.path)\n',
        "request timing start",
    )

    source = replace_once(
        source,
        '        finally:\n'
        '            if gate_acquired:\n'
        '                self.server.k12_shared_gate.release()\n\n'
        '    def forward_headers(self, upstream_key, body):\n',
        '        finally:\n'
        '            if gate_acquired:\n'
        '                self.server.k12_shared_gate.release()\n'
        '            if self._balanced_private_route:\n'
        '                self.server.release_private_route(self._balanced_private_route)\n'
        '            elapsed = time.monotonic() - request_started\n'
        '            sys.stderr.write(\n'
        '                f"request timing: kind={kind or \'unknown\'} route={self._balanced_private_route or \'none\'} "\n'
        '                f"total_seconds={elapsed:.3f}\\n"\n'
        '            )\n\n'
        '    def forward_headers(self, upstream_key, body):\n',
        "request timing completion",
    )

    source = replace_once(
        source,
        '        response = requests.request(\n'
        '            self.command,\n',
        '        upstream_started = time.monotonic()\n'
        '        response = requests.request(\n'
        '            self.command,\n',
        "upstream timing start",
    )
    source = replace_once(
        source,
        '        set_response_stream_idle_timeout(response, self.cfg.stream_idle_timeout)\n'
        '        return response\n\n'
        '    def request_with_fallbacks(self, kind, route, parsed, body, payload):\n',
        '        set_response_stream_idle_timeout(response, self.cfg.stream_idle_timeout)\n'
        '        header_seconds = time.monotonic() - upstream_started\n'
        '        sys.stderr.write(\n'
        '            f"upstream headers: route={route} status={response.status_code} "\n'
        '            f"seconds={header_seconds:.3f} body_bytes={len(body or b\'\')}\\n"\n'
        '        )\n'
        '        return response\n\n'
        '    def request_with_fallbacks(self, kind, route, parsed, body, payload):\n',
        "upstream timing completion",
    )

    source = replace_once(
        source,
        '        self.pool_status_lock = threading.Lock()\n'
        '        self.request_queue_size = cfg.request_queue_size\n',
        '        self.pool_status_lock = threading.Lock()\n'
        '        self.private_route_lock = threading.Lock()\n'
        '        self.private_route_cursor = 0\n'
        '        self.private_route_active = {route: 0 for route in cfg.private_balanced_routes}\n'
        '        self.request_queue_size = cfg.request_queue_size\n',
        "server balancing state",
    )

    source = replace_once(
        source,
        '        super().__init__(address, handler)\n\n\n'
        'def main():\n',
        '        super().__init__(address, handler)\n\n'
        '    def acquire_private_route(self):\n'
        '        routes = self.cfg.private_balanced_routes or [self.cfg.private_default_route]\n'
        '        with self.private_route_lock:\n'
        '            minimum = min(self.private_route_active.get(route, 0) for route in routes)\n'
        '            candidates = [route for route in routes if self.private_route_active.get(route, 0) == minimum]\n'
        '            route = candidates[self.private_route_cursor % len(candidates)]\n'
        '            self.private_route_cursor += 1\n'
        '            self.private_route_active[route] = self.private_route_active.get(route, 0) + 1\n'
        '            return route\n\n'
        '    def release_private_route(self, route):\n'
        '        with self.private_route_lock:\n'
        '            self.private_route_active[route] = max(0, self.private_route_active.get(route, 0) - 1)\n\n\n'
        'def main():\n',
        "server balancing methods",
    )
    return source, True


def atomic_write(path, content, mode=0o600):
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--router", required=True)
    parser.add_argument("--env", required=True)
    parser.add_argument("--routes", default="codex666,tianji,cctq")
    parser.add_argument("--backup-root")
    args = parser.parse_args()

    router = Path(args.router).resolve()
    env_file = Path(args.env).resolve()
    backup_root = Path(args.backup_root).resolve() if args.backup_root else router.parent / "backups" / "router-performance"
    backup_dir = backup_root / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    source = router.read_text(encoding="utf-8")
    patched, changed = patch_router(source)
    if changed:
        compile(patched, str(router), "exec")
    env_source = env_file.read_text(encoding="utf-8")
    env_patched = update_env(env_source, "PRIVATE_BALANCED_ROUTES", args.routes)
    env_changed = env_source != env_patched

    if changed or env_changed:
        backup_dir.mkdir(parents=True, mode=0o700)
        shutil.copy2(router, backup_dir / router.name)
        shutil.copy2(env_file, backup_dir / env_file.name)
    if changed:
        atomic_write(router, patched)
        py_compile.compile(str(router), doraise=True)
    if env_changed:
        atomic_write(env_file, env_patched)

    print(json.dumps({
        "status": "patched" if changed or env_changed else "already-current",
        "routerChanged": changed,
        "envChanged": env_changed,
        "routes": args.routes.split(","),
        "backupDirectory": str(backup_dir) if changed or env_changed else None,
    }))


if __name__ == "__main__":
    main()
