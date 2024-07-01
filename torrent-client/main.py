import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.parse
import psutil
from downloader import Downloader
from time import time

torrent_port = sys.argv[1]
http_port = sys.argv[2]
rpc_password = sys.argv[3]
initial_download = json.loads(urllib.parse.unquote(sys.argv[4]))

downloader = Downloader(torrent_port)

downloader.start_download(initial_download['game_id'], initial_download['magnet'], initial_download['save_path'])

class Handler(BaseHTTPRequestHandler):
    rpc_password_header = 'x-hydra-rpc-password'

    def do_GET(self):
        if self.path == "/status":
            if self.headers.get(self.rpc_password_header) != rpc_password:
                self.send_response(401)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()

            status = downloader.get_download_status()

            self.wfile.write(json.dumps(status).encode('utf-8'))
        if self.path == "/healthcheck":
            self.send_response(200)
            self.end_headers()
        
        if self.path == "/process":
            start_time = time()
            process_path = set([proc.info["exe"] for proc in psutil.process_iter(['exe'])])
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(list(process_path)).encode('utf-8'))
            print(time() - start_time)
    
    def do_POST(self):
        if self.path == "/action":
            if self.headers.get(self.rpc_password_header) != rpc_password:
                self.send_response(401)
                self.end_headers()
                return

            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            if data['action'] == 'start':
                downloader.start_download(data['game_id'], data['magnet'], data['save_path'])
            elif data['action'] == 'pause':
                downloader.pause_download(data['game_id'])
            elif data['action'] == 'cancel':
                downloader.cancel_download(data['game_id'])
        
            self.send_response(200)
            self.end_headers()


if __name__ == "__main__":
    httpd = HTTPServer(("", int(http_port)), Handler)
    httpd.serve_forever()
