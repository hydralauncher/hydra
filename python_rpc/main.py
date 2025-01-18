from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import urllib.parse
import sys
import psutil
from torrent_downloader import TorrentDownloader
from http_downloader import HttpDownloader
from profile_image_processor import ProfileImageProcessor
import libtorrent as lt

# Retrieve command line arguments
torrent_port = sys.argv[1]
http_port = int(sys.argv[2])
rpc_password = sys.argv[3]
start_download_payload = sys.argv[4]
start_seeding_payload = sys.argv[5]

downloads = {}
downloading_game_id = -1

torrent_session = lt.session({'listen_interfaces': f'0.0.0.0:{torrent_port}'})

if start_download_payload:
    initial_download = json.loads(urllib.parse.unquote(start_download_payload))
    downloading_game_id = initial_download['game_id']

    if initial_download['url'].startswith('magnet'):
        torrent_downloader = TorrentDownloader(torrent_session)
        downloads[initial_download['game_id']] = torrent_downloader
        try:
            torrent_downloader.start_download(initial_download['url'], initial_download['save_path'], "")
        except Exception as e:
            print("Error starting torrent download", e)
    else:
        http_downloader = HttpDownloader()
        downloads[initial_download['game_id']] = http_downloader
        try:
            http_downloader.start_download(initial_download['url'], initial_download['save_path'], initial_download.get('header'))
        except Exception as e:
            print("Error starting http download", e)

if start_seeding_payload:
    initial_seeding = json.loads(urllib.parse.unquote(start_seeding_payload))
    for seed in initial_seeding:
        torrent_downloader = TorrentDownloader(torrent_session, lt.torrent_flags.upload_mode)
        downloads[seed['game_id']] = torrent_downloader
        try:
            torrent_downloader.start_download(seed['url'], seed['save_path'], "")
        except Exception as e:
            print("Error starting seeding", e)

class RequestHandler(BaseHTTPRequestHandler):
    def validate_rpc_password(self):
        header_password = self.headers.get('x-hydra-rpc-password')
        if header_password != rpc_password:
            self.send_response(401)
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Unauthorized"}).encode('utf-8'))
            return False
        return True

    def do_GET(self):
        if self.path == "/status":
            if not self.validate_rpc_password():
                return

            downloader = downloads.get(downloading_game_id)
            if downloader:
                status = downloader.get_download_status()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(status).encode('utf-8'))
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(None).encode('utf-8'))

        elif self.path == "/seed-status":
            if not self.validate_rpc_password():
                return

            seed_status = []
            for game_id, downloader in downloads.items():
                if not downloader:
                    continue

                response = downloader.get_download_status()
                if response is None:
                    continue

                if response.get('status') == 5:
                    seed_status.append({
                        'gameId': game_id,
                        **response,
                    })

            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps(seed_status).encode('utf-8'))

        elif self.path == "/healthcheck":
            self.send_response(200)
            self.end_headers()

        elif self.path == "/process-list":
            if not self.validate_rpc_password():
                return

            process_list = [proc.info for proc in psutil.process_iter(['exe', 'pid', 'name'])]
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps(process_list).encode('utf-8'))

    def do_POST(self):
        if not self.validate_rpc_password():
            return

        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data.decode('utf-8'))

        if self.path == "/profile-image":
            image_path = data.get('image_path')
            try:
                processed_image_path, mime_type = ProfileImageProcessor.process_image(image_path)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'imagePath': processed_image_path, 'mimeType': mime_type}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

        elif self.path == "/action":
            global downloading_game_id
            action = data.get('action')
            game_id = data.get('game_id')

            if action == 'start':
                url = data.get('url')

                existing_downloader = downloads.get(game_id)

                if url.startswith('magnet'):
                    if existing_downloader and isinstance(existing_downloader, TorrentDownloader):
                        existing_downloader.start_download(url, data['save_path'], "")
                    else:
                        torrent_downloader = TorrentDownloader(torrent_session)
                        downloads[game_id] = torrent_downloader
                        torrent_downloader.start_download(url, data['save_path'], "")
                else:
                    if existing_downloader and isinstance(existing_downloader, HttpDownloader):
                        existing_downloader.start_download(url, data['save_path'], data.get('header'))
                    else:
                        http_downloader = HttpDownloader()
                        downloads[game_id] = http_downloader
                        http_downloader.start_download(url, data['save_path'], data.get('header'))

                downloading_game_id = game_id

            elif action == 'pause':
                downloader = downloads.get(game_id)
                if downloader:
                    downloader.pause_download()
                    downloading_game_id = -1
            elif action == 'cancel':
                downloader = downloads.get(game_id)
                if downloader:
                    downloader.cancel_download()
            elif action == 'resume_seeding':
                torrent_downloader = TorrentDownloader(torrent_session, lt.torrent_flags.upload_mode)
                downloads[game_id] = torrent_downloader
                torrent_downloader.start_download(data['url'], data['save_path'], "")
            elif action == 'pause_seeding':
                downloader = downloads.get(game_id)
                if downloader:
                    downloader.cancel_download()
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Invalid action"}).encode('utf-8'))
                return

            self.send_response(200)
            self.end_headers()

if __name__ == "__main__":
    server = HTTPServer(('0.0.0.0', http_port), RequestHandler)
    print(f"Server running on port {http_port}")
    server.serve_forever()
