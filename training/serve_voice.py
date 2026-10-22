r"""Serve training/voice-out/ to the dev page, to try an export before uploading it to R2.

    .\training\.venv\Scripts\python.exe training\serve_voice.py
    then open http://localhost:5173/chatter/?voicehost=http://localhost:8787/

    .\training\.venv\Scripts\python.exe training\serve_voice.py --battle
    then open http://localhost:5173/battle/?voicehost=http://localhost:8787/

Files are served at /voice/<version>/... (or /battle-voice/<version>/... with --battle), the
same paths as the bucket, with the CORS and cross-origin headers the page needs.
"""

import http.server
import sys
from pathlib import Path

BATTLE = "--battle" in sys.argv
ROOT = Path(__file__).resolve().parent / ("battle-voice-out" if BATTLE else "voice-out")
PREFIX = "/battle-voice" if BATTLE else "/voice"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        return super().translate_path(path.removeprefix(PREFIX))

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "range")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()


print("serving", ROOT, f"at http://localhost:8787{PREFIX}/")
http.server.ThreadingHTTPServer(("127.0.0.1", 8787), Handler).serve_forever()
