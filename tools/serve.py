"""Serve TDsports and its JSON API.

Usage: python3 tools/serve.py [port]        (default 8000, bound to 127.0.0.1)

A static file server for the project folder that tells browsers to revalidate every file
(so edits show up on a normal refresh), with three additions for the API:
  * /api/v1/<path> also answers without the .json extension (/api/v1/matches)
  * /api/v1/live is served from live.json, which Agent Tom refreshes every 30 seconds
  * API responses carry CORS headers so other web pages can fetch them, and unknown
    API paths return a JSON 404 instead of an HTML page
Build the API files with `node tools/build-api.js`.
"""
import http.server
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = '/api/v1'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def is_api(self):
        return self.path.split('?')[0].startswith(API)

    def translate_path(self, path):
        clean = path.split('?')[0].split('#')[0].rstrip('/')
        if clean in (API + '/live', API + '/live.json'):
            return os.path.join(ROOT, 'live.json')
        if clean.startswith(API):
            if clean == API:
                clean = API + '/index'
            if not clean.endswith('.json'):
                clean += '.json'
        return super().translate_path(clean if clean.startswith(API) else path)

    def end_headers(self):
        if self.is_api():
            self.send_header('Access-Control-Allow-Origin', '*')
        # Always revalidate, so edited data, scripts and photos show up on a normal refresh
        # (without this, browsers guess a cache lifetime from Last-Modified and keep old files).
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def send_error(self, code, message=None, explain=None):
        if not self.is_api():
            return super().send_error(code, message, explain)
        body = json.dumps({'error': {'status': code, 'message': message or self.responses.get(code, ('',))[0],
                                     'path': self.path}}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
