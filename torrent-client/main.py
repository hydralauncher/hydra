import libtorrent as lt
import sys
import json
import threading
import time
from fifo import Fifo

class TorrentManager:
    def __init__(self, torrent_port, read_sock_path, write_sock_path):
        self.torrent_port = torrent_port
        self.session = lt.session({'listen_interfaces': '0.0.0.0:{}'.format(torrent_port)})
        self.read_fifo = Fifo(read_sock_path)
        self.write_fifo = Fifo(write_sock_path)
        self.torrent_handle = None
        self.downloading_game_id = 0
        self.lock = threading.Lock()

    def get_eta(self, status):
        remaining_bytes = status.total_wanted - status.total_wanted_done
        if remaining_bytes >= 0 and status.download_rate > 0:
            return (remaining_bytes / status.download_rate) * 1000
        else:
            return 1

    def start_download(self, game_id: int, magnet: str, save_path: str):
        with self.lock:
            params = {'url': magnet, 'save_path': save_path}
            self.torrent_handle = self.session.add_torrent(params)
            self.downloading_game_id = game_id
            self.torrent_handle.set_flags(lt.torrent_flags.auto_managed)
            self.torrent_handle.resume()

    def pause_download(self):
        with self.lock:
            if self.torrent_handle:
                self.torrent_handle.pause()
                self.torrent_handle.unset_flags(lt.torrent_flags.auto_managed)
                self.downloading_game_id = 0

    def cancel_download(self):
        with self.lock:
            if self.torrent_handle:
                self.torrent_handle.pause()
                self.session.remove_torrent(self.torrent_handle)
                self.torrent_handle = None
                self.downloading_game_id = 0

    def get_download_updates(self):
        while True:
            with self.lock:
                if self.downloading_game_id == 0:
                    time.sleep(0.5)
                    continue

                status = self.torrent_handle.status()
                info = self.torrent_handle.get_torrent_info()

            self.write_fifo.send_message(json.dumps({
                'folderName': info.name() if info else "",
                'fileSize': info.total_size() if info else 0,
                'gameId': self.downloading_game_id,
                'progress': status.progress,
                'downloadSpeed': status.download_rate,
                'timeRemaining': self.get_eta(status),
                'numPeers': status.num_peers,
                'numSeeds': status.num_seeds,
                'status': status.state,
                'bytesDownloaded': status.progress * info.total_size() if info else status.all_time_download,
            }))

            if status.progress == 1:
                self.cancel_download()

            time.sleep(0.5)

    def listen_to_socket(self):
        while True:
            msg = self.read_fifo.recv(1024 * 2)
            payload = json.loads(msg.decode("utf-8"))

            if payload['action'] == "start":
                self.start_download(payload['game_id'], payload['magnet'], payload['save_path'])
            elif payload['action'] == "pause":
                self.pause_download()
            elif payload['action'] == "cancel":
                self.cancel_download()

if __name__ == "__main__":
    torrent_port = sys.argv[1]
    read_sock_path = sys.argv[2]
    write_sock_path = sys.argv[3]

    torrent_manager = TorrentManager(torrent_port, read_sock_path, write_sock_path)

    p1 = threading.Thread(target=torrent_manager.get_download_updates)
    p2 = threading.Thread(target=torrent_manager.listen_to_socket)

    p1.start()
    p2.start()
