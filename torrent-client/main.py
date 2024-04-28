import sys
from fifo import Fifo
import json
import threading
import time
from torrent_downloader import TorrentDownloader
from debrid_downloader import DebridDownloader

torrent_port = sys.argv[1]
read_sock_path = sys.argv[2]
write_sock_path = sys.argv[3]

read_fifo = Fifo(read_sock_path)
write_fifo = Fifo(write_sock_path)

downloading_game_id = 0
debrid_enabled = False

torrent_downloader = TorrentDownloader(torrent_port)
debrid_downloader = DebridDownloader()

def get_eta(status):
    remaining_bytes = status.total_wanted - status.total_wanted_done

    if remaining_bytes >= 0 and status.download_rate > 0:
        return (remaining_bytes / status.download_rate) * 1000
    else:
        return 1

def start_download(game_id: int, magnet: str, save_path: str, debrid_api_key: str):
    global downloading_game_id

    downloading_game_id = game_id
    if debrid_enabled:
        debrid_downloader.set_api_key(debrid_api_key)
        debrid_downloader.start_download(magnet, save_path)
    else:
        torrent_downloader.start_download(magnet, save_path)

def pause_download():
    global downloading_game_id

    if debrid_enabled:
        debrid_downloader.pause_download()
    elif torrent_downloader.get_handler():
        torrent_downloader.pause_download()
    downloading_game_id = 0

def cancel_download():
    global downloading_game_id

    if debrid_enabled:
        debrid_downloader.cancel_download()
    elif torrent_downloader.get_handler():
        torrent_downloader.cancel_download()
    downloading_game_id = 0

def get_download_updates():
    global downloading_game_id

    while True:
        if downloading_game_id == 0:
            time.sleep(0.5)
            continue

        if debrid_enabled:
            download_info = debrid_downloader.get_status(downloading_game_id)
        else:
            download_info = torrent_downloader.get_status(downloading_game_id)

        write_fifo.send_message(json.dumps(download_info))

        if download_info['progress'] == 1 or download_info['status'] == 0:
            cancel_download()

        time.sleep(0.5)

def listen_to_socket():
    global debrid_enabled

    while True:
        msg = read_fifo.recv(1024 * 2)
        payload = json.loads(msg.decode("utf-8"))

        if payload['action'] == "start":
            debrid_enabled = payload['debrid_enabled']
            start_download(
                payload['game_id'],
                payload['magnet'],
                payload['save_path'],
                payload['debrid_api_key']
            )
            continue
        
        if payload['action'] == "pause":
            pause_download()
            continue
            
        if payload['action'] == "cancel":
            cancel_download()

if __name__ == "__main__":
    p1 = threading.Thread(target=get_download_updates)
    p2 = threading.Thread(target=listen_to_socket)

    p1.start()
    p2.start()

    p1.join()
    p2.join()