"""Serve the built web bundle as a plain static site.

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

INDEX_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GTFS route tiles</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" />
  <script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
  <script src="https://unpkg.com/pmtiles@4.5.0/dist/pmtiles.js"></script>
  <style>
    html, body { height: 100%; margin: 0; }
    #map { position: absolute; inset: 0; }
    #panel {
      position: absolute; top: 10px; left: 10px; z-index: 1;
      background: rgba(255,255,255,.92); padding: 8px 12px; border-radius: 6px;
      font: 13px/1.5 system-ui, sans-serif; box-shadow: 0 1px 4px rgba(0,0,0,.3);
    }
    #panel label { display: block; cursor: pointer; }
    #errors {
      display: none; position: absolute; bottom: 0; left: 0; right: 0; z-index: 2;
      margin: 0; padding: 8px 12px; max-height: 40%; overflow: auto;
      background: #b00020; color: #fff; font: 12px/1.4 ui-monospace, monospace;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="panel">
    <label><input type="checkbox" id="routes" checked> Transit routes</label>
    <label><input type="checkbox" id="labels" checked> Route labels</label>
  </div>
  <pre id="errors"></pre>
  <script>
    // A blank map is otherwise indistinguishable from a map of the ocean, so
    // put failures on the page rather than only in the console.
    const errBox = document.getElementById('errors');
    const fail = (msg) => {
      errBox.style.display = 'block';
      errBox.textContent += msg + '\\n';
      console.error(msg);
    };
    window.addEventListener('error', (e) => fail('js: ' + e.message));

    // Teach MapLibre to read pmtiles:// URLs via HTTP range requests.
    maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);

    (async () => {
      const style = await (await fetch('./style.json')).json();

      // MapLibre resolves relative URLs in a style against that style's own
      // URL. We hand it a parsed object rather than a URL (so the pmtiles
      // paths can be rewritten first), which leaves it no base to resolve
      // against — so every relative URL in the style has to be absolute here.
      // The glyphs template is the awkward one: new URL() percent-encodes the
      // {fontstack}/{range} braces, and MapLibre substitutes on the literal
      // tokens, so they have to survive the round trip intact.
      const abs = (rel) => new URL(
        rel.replace(/\\{/g, '%7B').replace(/\\}/g, '%7D'), location.href
      ).href.replace(/%7B/g, '{').replace(/%7D/g, '}');

      style.sprite = abs(style.sprite);
      style.glyphs = abs(style.glyphs);
      for (const src of Object.values(style.sources)) {
        if (src.url && src.url.startsWith('pmtiles://')) {
          src.url = 'pmtiles://' + abs(src.url.slice('pmtiles://'.length));
        }
      }

      const map = new maplibregl.Map({
        container: 'map',
        style,
        center: [-70.2553, 43.6591],   // Portland, ME
        zoom: 12,
        hash: true
      });
      window.map = map;
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.addControl(new maplibregl.ScaleControl());

      const bind = (id, layer) => {
        document.getElementById(id).addEventListener('change', (e) => {
          map.setLayoutProperty(layer, 'visibility',
                                e.target.checked ? 'visible' : 'none');
        });
      };
      map.on('load', () => {
        bind('routes', 'transit-routes');
        bind('labels', 'transit-route-labels');
      });
      map.on('error', (e) => fail('maplibre: ' +
        ((e && e.error && e.error.message) || JSON.stringify(e && e.error) || e)));
      wire(map);
    })().catch((e) => fail('startup: ' + (e && e.message || e)));

    function wire(map) {
      // Click a route to see which one it is.
      const popup = new maplibregl.Popup({ closeButton: false });
      map.on('click', 'transit-routes', (e) => {
        const p = e.features[0].properties;
        popup.setLngLat(e.lngLat)
             .setHTML(`<b>${p.label || p.route_id}</b><br>` +
                      `slot ${p.offset} of ${p.bundle} on this segment`)
             .addTo(map);
      });
      map.on('mouseenter', 'transit-routes', () => map.getCanvas().style.cursor = 'pointer');
      map.on('mouseleave', 'transit-routes', () => map.getCanvas().style.cursor = '');
    }
  </script>
</body>
</html>
"""

CONTENT_TYPES = {
    ".pmtiles": "application/octet-stream",
    ".pbf": "application/x-protobuf",
    ".json": "application/json",
    ".png": "image/png",
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
        if self.path.split("?")[0] in ("/", "/index.html"):
            body = INDEX_HTML.encode("utf-8")
            self.send_response(200)
            self._headers("text/html; charset=utf-8", len(body))
            self.wfile.write(body)
            return

        if self.path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        path = Path(self.translate_path(self.path.split("?")[0]))
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
