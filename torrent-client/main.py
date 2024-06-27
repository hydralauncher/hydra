import libtorrent as lt
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import threading
import time

torrent_port = sys.argv[1]
http_port = sys.argv[2]

print(http_port)

session = lt.session({'listen_interfaces': '0.0.0.0:{port}'.format(port=torrent_port)})

torrent_handles = {}
downloading_game_id = -1

def start_download(game_id: int, magnet: str, save_path: str):
    global torrent_handles
    global downloading_game_id

    params = {'url': magnet, 'save_path': save_path}
    torrent_handle = session.add_torrent(params)
    torrent_handles[game_id] = torrent_handle
    torrent_handle.set_flags(lt.torrent_flags.auto_managed)
    torrent_handle.resume()

    downloading_game_id = game_id

def pause_download(game_id: int):
    global torrent_handles
    global downloading_game_id

    torrent_handle = torrent_handles.get(game_id)
    if torrent_handle:
        torrent_handle.pause()
        torrent_handle.unset_flags(lt.torrent_flags.auto_managed)
        downloading_game_id = -1

def cancel_download(game_id: int):
    global torrent_handles
    global downloading_game_id

    torrent_handle = torrent_handles.get(game_id)
    if torrent_handle:
        torrent_handle.pause()
        session.remove_torrent(torrent_handle)
        torrent_handles[game_id] = None
        downloading_game_id =-1

def get_download_updates():
    global torrent_handles
    global downloading_game_id

    while True:
        if downloading_game_id == -1:
            time.sleep(0.5)
            continue

        torrent_handle = torrent_handles.get(downloading_game_id)

        status = torrent_handle.status()
        info = torrent_handle.get_torrent_info()

        Handler.current_status = {
            'folderName': info.name() if info else "",
            'fileSize': info.total_size() if info else 0,
            'gameId': downloading_game_id,
            'progress': status.progress,
            'downloadSpeed': status.download_rate,
            'numPeers': status.num_peers,
            'numSeeds': status.num_seeds,
            'status': status.state,
            'bytesDownloaded': status.progress * info.total_size() if info else status.all_time_download,
        }

        if status.progress == 1:
            cancel_download(downloading_game_id)

        time.sleep(0.5)


class Handler(BaseHTTPRequestHandler):
    current_status = None

    def do_GET(self):
        if self.path == "/status":
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()

            self.wfile.write(json.dumps(self.current_status).encode('utf-8'))
    
    def do_POST(self):
        if self.path == "/action":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            if data['action'] == 'start':
                start_download(data['game_id'], data['magnet'], data['save_path'])
            elif data['action'] == 'pause':
                pause_download(data['game_id'])
                self.current_status = None
            elif data['action'] == 'cancel':
                cancel_download(data['game_id'])
                self.current_status = None
        
            self.send_response(200)
            self.end_headers()


if __name__ == "__main__":
    p1 = threading.Thread(target=get_download_updates)

    httpd = HTTPServer(("", int(http_port)), Handler)
    p2 = threading.Thread(target=httpd.serve_forever)

    p1.start()
    p2.start()
