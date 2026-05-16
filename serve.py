import http.server
import socketserver
from argparse import ArgumentParser
from functools import partial

INDEX_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tile preview</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>html, body, #map { height: 100%; margin: 0; }</style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map').setView([43.65, -70.25], 12);
    L.tileLayer('./{z}/{x}/{y}.png', {
      minZoom: 10,
      maxZoom: 16,
      tileSize: 256,
      attribution: '&copy; CARTO'
    }).addTo(map);
  </script>
</body>
</html>
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = INDEX_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


parser = ArgumentParser()
parser.add_argument("directory", help="tile directory (the output_dir from download.py)")
parser.add_argument("--port", type=int, default=8000)
args = parser.parse_args()

handler = partial(Handler, directory=args.directory)
with socketserver.TCPServer(("", args.port), handler) as httpd:
    print(f"Serving {args.directory} at http://localhost:{args.port}/  (Ctrl-C to stop)")
    httpd.serve_forever()
