"""Collect artefacts POSTed by the browser harness.

The exporter needs a browser (canvas + WebGL + GLTFExporter), so the .glb is
produced by tools/glb-harness/export.html and delivered here. Keeping the sink
in Python's stdlib means the harness adds no dependency to the project.

Usage::

    python tools/glb-harness/server.py --out /tmp/a4-validation
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROUTES = {
    "/artefakt/with-room": "model-with-room.glb",
    "/artefakt/furniture-only": "model-furniture-only.glb",
    "/artefakt/visual": "visual-stats.json",
    "/artefakt/model-with-room.glb": "model-with-room.glb",
}


def make_handler(out_dir: Path) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_POST(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler's name)
            route = self.path.split("?")[0]
            filename = ROUTES.get(route)
            length = int(self.headers.get("content-length", "0"))
            body = self.rfile.read(length) if length else b""

            if filename is None:
                self.send_error(404, f"unknown route {route}")
                return

            target = out_dir / filename
            target.write_bytes(body)
            sys.stderr.write(f"wrote {target} ({len(body)} bytes)\n")
            sys.stderr.flush()
            self.send_response(200)
            self.send_header("content-length", "0")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler's name)
            route = self.path.split("?")[0]
            filename = ROUTES.get(route)
            if filename is None or not (out_dir / filename).exists():
                self.send_error(404, f"no artefact for {route}")
                return
            body = (out_dir / filename).read_bytes()
            self.send_response(200)
            self.send_header("content-type", "application/octet-stream")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args: object) -> None:
            sys.stderr.write("sink " + (fmt % args) + "\n")
            sys.stderr.flush()

    return Handler


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="collect GLB harness artefacts")
    parser.add_argument("--out", default="/tmp/a4-validation", help="directory to write artefacts into")
    parser.add_argument("--port", type=int, default=5300)
    args = parser.parse_args(argv)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(out_dir))
    print(json.dumps({"listening": f"http://127.0.0.1:{args.port}", "out": str(out_dir)}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
