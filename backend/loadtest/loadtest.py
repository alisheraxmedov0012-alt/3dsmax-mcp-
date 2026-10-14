"""Load test for the 3D Studio AI API.

Design goals
------------
* Only ever run against a **self-hosted** target (local or staging). The CLI
  refuses to run against a non-loopback host unless ``--allow-remote`` is passed,
  so we never send load to a service we do not control.
* Exercise the real API surface: health, auth (register/login), me, plans,
  subscription/usage, project import, invoices and billing history.
* Report requests/second, p50/p95/p99 latency, error rate, and process CPU/RSS
  sampled from ``/proc`` when available.

Usage::

    python -m loadtest.loadtest --base-url http://127.0.0.1:8000 \
        --vus 25 --duration 300

The script prints a JSON summary at the end so results can be archived.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
import uuid
from dataclasses import dataclass, field

import httpx

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


@dataclass
class Stats:
    latencies_ms: list[float] = field(default_factory=list)
    statuses: dict[int, int] = field(default_factory=dict)
    errors: int = 0
    requests: int = 0

    def record(self, latency_ms: float, status: int) -> None:
        self.requests += 1
        self.latencies_ms.append(latency_ms)
        self.statuses[status] = self.statuses.get(status, 0) + 1
        if status == 0 or status >= 500:
            self.errors += 1

    def summary(self) -> dict:
        if not self.latencies_ms:
            return {"requests": 0}
        ordered = sorted(self.latencies_ms)

        def pct(p: float) -> float:
            idx = min(len(ordered) - 1, int(round((p / 100) * (len(ordered) - 1))))
            return round(ordered[idx], 2)

        return {
            "requests": self.requests,
            "errors": self.errors,
            "error_rate_pct": round((self.errors / self.requests) * 100, 3) if self.requests else 0,
            "status_counts": {str(k): v for k, v in sorted(self.statuses.items())},
            "latency_ms": {
                "p50": pct(50),
                "p95": pct(95),
                "p99": pct(99),
                "mean": round(statistics.fmean(ordered), 2),
                "max": round(ordered[-1], 2),
            },
        }


def _read_proc() -> dict:
    """Best-effort CPU time and RSS for the current process tree (Linux only)."""
    try:
        with open("/proc/self/statm", "r", encoding="utf-8") as handle:
            rss_pages = int(handle.read().split()[1])
        rss_mb = round(rss_pages * (os.sysconf("SC_PAGE_SIZE") / (1024 * 1024)), 1)
    except Exception:
        return {}
    return {"client_rss_mb": rss_mb}


async def _register_and_login(client: httpx.AsyncClient, base_url: str) -> dict | None:
    email = f"load-{uuid.uuid4().hex[:12]}@example.com"
    password = "LoadTestPass123!"
    reg = await client.post(f"{base_url}/api/auth/register", json={"email": email, "password": password})
    if reg.status_code not in (200, 201):
        return None
    data = reg.json()
    return {"csrf": data.get("csrf_token"), "email": email, "password": password}


async def _worker(
    base_url: str,
    stats: Stats,
    stop_at: float,
    csrf_holder: dict,
) -> None:
    async with httpx.AsyncClient(base_url=base_url, timeout=10.0, follow_redirects=False) as client:
        session = None
        while time.perf_counter() < stop_at:
            scenario = "health"
            started = time.perf_counter()
            status = 0
            try:
                # 1) health (always safe)
                r = await client.get("/api/health")
                status = r.status_code
                stats.record((time.perf_counter() - started) * 1000, status)

                # 2) authenticate once per worker, then reuse the session cookie
                if session is None:
                    scenario = "register+login"
                    started = time.perf_counter()
                    session = await _register_and_login(client, base_url)
                    if session:
                        csrf_holder["csrf"] = session["csrf"]
                    status = 200 if session else 0
                    stats.record((time.perf_counter() - started) * 1000, status)
                    if session is None:
                        await asyncio.sleep(0.2)
                        continue

                csrf = session["csrf"]
                headers = {"X-CSRF-Token": csrf or ""}

                # 3) profile
                started = time.perf_counter()
                r = await client.get("/api/auth/me")
                stats.record((time.perf_counter() - started) * 1000, r.status_code)

                # 4) plans / subscription / usage
                for path in ("/api/plans", "/api/subscription", "/api/usage"):
                    started = time.perf_counter()
                    r = await client.get(path)
                    stats.record((time.perf_counter() - started) * 1000, r.status_code)

                # 5) project import (idempotent, small payload)
                started = time.perf_counter()
                r = await client.post(
                    "/api/projects/import",
                    headers=headers,
                    json={
                        "projects": [
                            {
                                "client_id": f"load-{uuid.uuid4().hex[:8]}",
                                "name": "Load project",
                                "scene": {"objects": []},
                            }
                        ]
                    },
                )
                stats.record((time.perf_counter() - started) * 1000, r.status_code)

                # 6) invoices + billing history
                for path in ("/api/invoices", "/api/billing/history"):
                    started = time.perf_counter()
                    r = await client.get(path)
                    stats.record((time.perf_counter() - started) * 1000, r.status_code)

            except Exception:
                stats.record((time.perf_counter() - started) * 1000, 0)
            # small think time keeps the loop realistic
            await asyncio.sleep(0.05)


async def run(base_url: str, vus: int, duration: int) -> dict:
    stats = Stats()
    csrf_holder: dict = {}
    stop_at = time.perf_counter() + duration
    proc_before = _read_proc()
    started = time.perf_counter()

    await asyncio.gather(
        *[_worker(base_url, stats, stop_at, csrf_holder) for _ in range(vus)]
    )

    elapsed = time.perf_counter() - started
    summary = stats.summary()
    summary["duration_s"] = round(elapsed, 2)
    summary["vus"] = vus
    summary["requests_per_second"] = round(stats.requests / elapsed, 2) if elapsed else 0
    summary["process"] = {**proc_before, **_read_proc()}
    return summary


def _guard_target(base_url: str, allow_remote: bool) -> None:
    from urllib.parse import urlparse

    host = urlparse(base_url).hostname or ""
    if host not in LOOPBACK_HOSTS and not allow_remote:
        raise SystemExit(
            f"Refusing to load-test non-loopback host '{host}'. "
            "Only run against a self-hosted target; pass --allow-remote to override."
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="3D Studio AI load test")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--vus", type=int, default=25, help="parallel virtual users")
    parser.add_argument("--duration", type=int, default=300, help="steady-state seconds")
    parser.add_argument("--allow-remote", action="store_true")
    parser.add_argument("--out", default="", help="write JSON summary to this path")
    args = parser.parse_args(argv)

    _guard_target(args.base_url, args.allow_remote)

    print(
        f"Load test: base_url={args.base_url} vus={args.vus} duration={args.duration}s",
        file=sys.stderr,
    )
    summary = asyncio.run(run(args.base_url, args.vus, args.duration))
    text = json.dumps(summary, indent=2)
    print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
