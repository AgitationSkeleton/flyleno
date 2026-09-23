"""Local dev server that disables browser caching, so edits to js/ show up on a normal reload.

    python tools/serve.py [port]        (default 8123) -> open http://localhost:8123/
"""
import functools
import http.server
import os
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    handler = functools.partial(NoCache, directory=root)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving {root} on http://localhost:{port}/ (no-cache)")
        httpd.serve_forever()
