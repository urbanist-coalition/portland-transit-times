"""Serve the built web bundle as a plain static site.

Serves the directory verbatim, including its index.html — the page is part of
the bundle (make_style.py copies it in), not something this script carries. An
earlier version embedded its own copy of the HTML, which promptly drifted from
the real one and served a stale page while the bundle on disk was correct.

The only thing this does beyond `python -m http.server` is HTTP Range
requests — and that is not optional. A PMTiles archive is read by fetching
byte ranges out of a single large file; without 206 responses the client tries
to pull all 117 MB of basemap for every tile and the map never renders.
Python's SimpleHTTPRequestHandler doesn't implement Range, hence this.

Everything served here is static, so the same directory drops onto S3, GitHub
Pages, Cloudflare, or any other host that honours Range — no tile server, no
backend.
"""

import http.server
import os
import re
import socketserver
from argparse import ArgumentParser
from functools import partial
from pathlib import Path

CONTENT_TYPES = {
    ".pmtiles": "application/octet-stream",
    ".pbf": "application/x-protobuf",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".html": "text/html; charset=utf-8",
}

RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    # Keep-alive matters here: reading a PMTiles archive is many small range
    # requests, and HTTP/1.0 tears down the connection after every one.
    protocol_version = "HTTP/1.1"

    def _headers(self, ctype, length, extra=None):
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        # Handy if you ever load the bundle from a different origin.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        path = Path(self.translate_path(self.path.split("?")[0]))
        if path.is_dir():
            path = path / "index.html"
        if not path.is_file():
            self.send_error(404, f"Not found: {self.path}")
            return

        size = path.stat().st_size
        ctype = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
        rng = self.headers.get("Range")

        if not rng:
            self.send_response(200)
            self._headers(ctype, size)
            with path.open("rb") as f:
                self.copyfile(f, self.wfile)
            return

        m = RANGE_RE.match(rng.strip())
        if not m:
            self.send_error(400, "Malformed Range header")
            return
        raw_start, raw_end = m.group(1), m.group(2)
        if raw_start == "":
            # Suffix form: "bytes=-N" means the final N bytes.
            length = int(raw_end or 0)
            start = max(0, size - length)
            end = size - 1
        else:
            start = int(raw_start)
            end = int(raw_end) if raw_end else size - 1
        end = min(end, size - 1)

        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        length = end - start + 1
        self.send_response(206)
        self._headers(ctype, length, {"Content-Range": f"bytes {start}-{end}/{size}"})
        with path.open("rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


parser = ArgumentParser(description="Serve the built web bundle (Range-capable).")
parser.add_argument("directory", nargs="?", default="out/web",
                    help="web root produced by the pipeline (default: out/web)")
parser.add_argument("--port", type=int, default=8000)
args = parser.parse_args()

if not os.path.isdir(args.directory):
    raise SystemExit(f"No such directory: {args.directory}")

handler = partial(RangeHandler, directory=args.directory)
with Server(("", args.port), handler) as httpd:
    print(f"Serving {args.directory} at http://localhost:{args.port}/  (Ctrl-C to stop)")
    httpd.serve_forever()
