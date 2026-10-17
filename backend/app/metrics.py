"""W11 in-process metrics registry.

Scope and honesty
-----------------
This is a **process-local** registry, not a monitoring provider. It exists so an
operator can scrape coarse counters (requests, job runs, retries, errors, job
duration) from ``/api/health/metrics`` without a paid service, and so tests can
assert behaviour. It deliberately does not claim to be Prometheus, a hosted
dashboard or an alerting system — nothing here alerts anyone.

Multi-process note: each worker process has its own counters. A real deployment
that needs aggregate metrics must wire a shared monitoring provider; the metrics
endpoint reports ``process_local: true`` to make that limitation explicit.
"""
from __future__ import annotations

import threading

_MAX_SERIES = 500

_lock = threading.Lock()
_counters: dict[tuple[str, tuple[tuple[str, str], ...]], int] = {}
_histograms: dict[tuple[str, tuple[tuple[str, str], ...]], dict[str, float]] = {}


def _labels(labels: dict[str, object]) -> tuple[tuple[str, str], ...]:
    return tuple(sorted((str(k), str(v)) for k, v in labels.items()))


def incr(name: str, value: int = 1, **labels: object) -> None:
    key = (name, _labels(labels))
    with _lock:
        if key not in _counters and len(_counters) >= _MAX_SERIES:
            return  # bounded: never grow without limit
        _counters[key] = _counters.get(key, 0) + int(value)


def observe(name: str, value: float, **labels: object) -> None:
    key = (name, _labels(labels))
    with _lock:
        if key not in _histograms and len(_histograms) >= _MAX_SERIES:
            return
        bucket = _histograms.setdefault(key, {"count": 0.0, "sum": 0.0, "min": value, "max": value})
        bucket["count"] += 1
        bucket["sum"] += float(value)
        bucket["min"] = min(bucket["min"], float(value))
        bucket["max"] = max(bucket["max"], float(value))


def snapshot() -> dict:
    """Return a JSON-serialisable, aggregate-only view (no secret values)."""
    with _lock:
        counters = [
            {"name": name, "labels": dict(labels), "value": value}
            for (name, labels), value in sorted(_counters.items())
        ]
        histograms = [
            {
                "name": name,
                "labels": dict(labels),
                "count": int(bucket["count"]),
                "sum": bucket["sum"],
                "min": bucket["min"],
                "max": bucket["max"],
                "avg": (bucket["sum"] / bucket["count"]) if bucket["count"] else 0.0,
            }
            for (name, labels), bucket in sorted(_histograms.items())
        ]
    return {
        "process_local": True,
        "counters": counters,
        "histograms": histograms,
    }


def reset() -> None:
    """Test helper: clear all series so assertions start from a clean slate."""
    with _lock:
        _counters.clear()
        _histograms.clear()


__all__ = ["incr", "observe", "reset", "snapshot"]
