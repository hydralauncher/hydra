import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import urllib.parse
import psutil
from api import torrentAPI

def print_help():
    print("Usage: hydra-download-manager <Torrent Port> <HTTP Port> <RPC Password> <Download Payload>")
    print("Testing: hydra-download-manager check <Torrent Client> Optional:<start|pause|cancel|Function Name to Test> <Magnet Link to Download|Hash to Use>")
    print("Testing Base: hydra-download-manager check base <Port to Bind to> Optional:<start|pause|cancel|Function Name to Test> <Magnet Link to Download|Hash to Use>")
    print("Torrent Clients to choose from: base, qbittorrent")

# Unit Testing/Parameter
for i in sys.argv:
    if (i == "-h" or i == "-H" or i == "--help" or i == "--HELP"):
        print_help()
        exit()
if len(sys.argv) == 1:
    print("must have at least one argument")
    print_help()
    exit(1)
elif (sys.argv[2] == "base" and sys.argv[1] == "check"):
    if len(sys.argv) < 5:
        print("Need Required Arguments")
        print_help()
        exit(1)
    torrent_downloader = torrentAPI(sys.argv[3], torrent_client = sys.argv[2])
    if len(sys.argv) == 6:
        trail = None
        if sys.argv[3] == "start" or sys.argv[3] == "pause" or sys.argv[3] == "cancel":
            trail = "_download"
        function = getattr(torrent_downloader, sys.argv[3] + (trail if trail else ""), "None")
        if sys.argv[3] == "start":
            print(function(-1, sys.argv[5]))
        else:
            print(function(sys.argv[5]))
    print(torrent_downloader)
    exit()
elif (sys.argv[1] == "check" and (len(sys.argv) <= 5 and len(sys.argv) >= 3)):
    torrent_downloader = torrentAPI(torrent_client = sys.argv[2])
    if len(sys.argv) > 3 and len(sys.argv) <= 5:
        trail = None
        if sys.argv[3] == "start" or sys.argv[3] == "pause" or sys.argv[3] == "cancel":
            trail = "_download"
        function = getattr(torrent_downloader, sys.argv[3] + (trail if trail else ""), "None")
        if sys.argv[3] == "start":
            function(-1, sys.argv[4])
        elif len(sys.argv) == 5:
            print(function(sys.argv[4]))
        elif len(sys.argv) == 4:
            print(print(function))
            function()
    print(torrent_downloader)
    exit()
# elif len(sys.argv) != 4:
#     print_help()
#     exit(1)

torrent_port = sys.argv[1]
http_port = sys.argv[2]
rpc_password = sys.argv[3]
download_payload = sys.argv[4]

torrent_downloader = None
if download_payload:
    initial_download = json.loads(urllib.parse.unquote(download_payload))
    torrent_downloader = torrentAPI(torrent_client = "qbittorrent")
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
                torrent_downloader = torrentAPI(torrent_client = "qbittorrent")

            if data['action'] == 'start':
                print(data)
                print(data['magnet'])
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