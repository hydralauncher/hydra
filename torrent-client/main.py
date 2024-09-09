import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.parse
import psutil
from torrent_downloader import TorrentDownloader

torrent_port = sys.argv[1]
http_port = sys.argv[2]
rpc_password = sys.argv[3]
start_download_payload = sys.argv[4]

torrent_downloader = None

if start_download_payload:
    initial_download = json.loads(urllib.parse.unquote(start_download_payload))
    torrent_downloader = TorrentDownloader(torrent_port)
    torrent_downloader.start_download(initial_download['game_id'], initial_download['magnet'], initial_download['save_path'])

class Handler(BaseHTTPRequestHandler):
    rpc_password_header = 'x-hydra-rpc-password'

    skip_log_routes = [
        "process-list",
        "status"
    ]

    def log_error(self, format, *args):
        sys.stderr.write("%s - - [%s] %s\n" %
                         (self.address_string(),
                          self.log_date_time_string(),
                          format%args))

    def log_message(self, format, *args):
        for route in self.skip_log_routes:
            if route in args[0]: return

        super().log_message(format, *args)
        
    def do_GET(self):
        if self.path == "/status":
            if self.headers.get(self.rpc_password_header) != rpc_password:
                self.send_response(401)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()

            status = torrent_downloader.get_download_status()

            self.wfile.write(json.dumps(status).encode('utf-8'))

        elif self.path == "/healthcheck":
            self.send_response(200)
            self.end_headers()
        
        elif self.path == "/process-list":
            if self.headers.get(self.rpc_password_header) != rpc_password:
                self.send_response(401)
                self.end_headers()
                return
            
            process_list = [proc.info for proc in psutil.process_iter(['exe', 'pid', 'username'])]

            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()

            self.wfile.write(json.dumps(process_list).encode('utf-8'))
    
    def do_POST(self):
        global torrent_downloader

        if self.path == "/action":
            if self.headers.get(self.rpc_password_header) != rpc_password:
                self.send_response(401)
                self.end_headers()
                return

            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            if torrent_downloader is None:
                torrent_downloader = TorrentDownloader(torrent_port)

            if data['action'] == 'start':
                torrent_downloader.start_download(data['game_id'], data['magnet'], data['save_path'])
            elif data['action'] == 'pause':
                torrent_downloader.pause_download(data['game_id'])
            elif data['action'] == 'cancel':
                torrent_downloader.cancel_download(data['game_id'])
            elif data['action'] == 'kill-torrent':
                torrent_downloader.abort_session()
                torrent_downloader = None

            self.send_response(200)
            self.end_headers()


if __name__ == "__main__":
    httpd = HTTPServer(("", int(http_port)), Handler)
    httpd.serve_forever()
