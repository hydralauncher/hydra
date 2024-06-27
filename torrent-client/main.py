import libtorrent as lt
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import threading
import time

torrent_port = sys.argv[1]
http_port = sys.argv[2]

class Downloader:
    def __init__(self):
        self.torrent_handles = {}
        self.downloading_game_id = -1
        self.session = lt.session({'listen_interfaces': '0.0.0.0:{port}'.format(port=torrent_port)})

    def start_download(self, game_id: int, magnet: str, save_path: str):
        params = {'url': magnet, 'save_path': save_path}
        torrent_handle = self.session.add_torrent(params)
        self.torrent_handles[game_id] = torrent_handle
        torrent_handle.set_flags(lt.torrent_flags.auto_managed)
        torrent_handle.resume()

        self.downloading_game_id = game_id

    def pause_download(self, game_id: int):
        torrent_handle = self.torrent_handles.get(game_id)
        if torrent_handle:
            torrent_handle.pause()
            torrent_handle.unset_flags(lt.torrent_flags.auto_managed)
            self.downloading_game_id = -1

    def cancel_download(self, game_id: int):
        torrent_handle = self.torrent_handles.get(game_id)
        if torrent_handle:
            torrent_handle.pause()
            self.session.remove_torrent(torrent_handle)
            self.torrent_handles[game_id] = None
            self.downloading_game_id = -1

    def get_download_status(self):
        if self.downloading_game_id == -1:
            return None

        torrent_handle = self.torrent_handles.get(self.downloading_game_id)

        status = torrent_handle.status()
        info = torrent_handle.get_torrent_info()

        return {
            'folderName': info.name() if info else "",
            'fileSize': info.total_size() if info else 0,
            'gameId': self.downloading_game_id,
            'progress': status.progress,
            'downloadSpeed': status.download_rate,
            'numPeers': status.num_peers,
            'numSeeds': status.num_seeds,
            'status': status.state,
            'bytesDownloaded': status.progress * info.total_size() if info else status.all_time_download,
        }


downloader = Downloader()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/status":
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()

            status = downloader.get_download_status()

            self.wfile.write(json.dumps(status).encode('utf-8'))
    
    def do_POST(self):
        if self.path == "/action":
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
