import libtorrent as lt
import sys
from fifo import Fifo
import json
import threading
import time

torrent_port = sys.argv[1]
read_sock_path = sys.argv[2]
write_sock_path = sys.argv[3]

session = lt.session({'listen_interfaces': '0.0.0.0:{port}'.format(port=torrent_port)})
read_fifo = Fifo(read_sock_path)
write_fifo = Fifo(write_sock_path)

torrent_handle = None
downloading_game_id = 0

def get_eta(status):
    remaining_bytes = status.total_wanted - status.total_wanted_done

    if remaining_bytes >= 0 and status.download_rate > 0:
        return (remaining_bytes / status.download_rate) * 1000
    else:
        return 1

def start_download(game_id: int, magnet: str, save_path: str):
    global torrent_handle
    global downloading_game_id

    params = {'url': magnet, 'save_path': save_path}
    torrent_handle = session.add_torrent(params)
    downloading_game_id = game_id
    torrent_handle.set_flags(lt.torrent_flags.auto_managed)
    torrent_handle.resume()

def pause_download():
    global downloading_game_id

    if torrent_handle:
        torrent_handle.pause()
        torrent_handle.unset_flags(lt.torrent_flags.auto_managed)
        downloading_game_id = 0

def cancel_download():
    global downloading_game_id
    global torrent_handle

    if torrent_handle:
        torrent_handle.pause()
        session.remove_torrent(torrent_handle)
        torrent_handle = None
        downloading_game_id = 0

def get_download_updates(download_limit = 0, upload_limit = 0):
    global torrent_handle

    # Set download and upload limits
    if download_limit > 0 and upload_limit > 0:
        torrent_handle.set_download_limit(download_limit*1024)
        torrent_handle.set_upload_limit(upload_limit*1024)
    elif download_limit > 0:
        torrent_handle.set_download_limit(download_limit*1024)
    elif upload_limit > 0:
        torrent_handle.set_upload_limit(upload_limit*1024)
    
    while True:
        if downloading_game_id == 0:
            time.sleep(0.5)
            continue

        status = torrent_handle.status()
        info = torrent_handle.get_torrent_info()

        write_fifo.send_message(json.dumps({
            'folderName': info.name() if info else "",
            'fileSize': info.total_size() if info else 0,
            'gameId': downloading_game_id,
            'progress': status.progress,
            'downloadSpeed': status.download_rate,
            'timeRemaining': get_eta(status),
            'numPeers': status.num_peers,
            'numSeeds': status.num_seeds,
            'status': status.state,
            'bytesDownloaded': status.progress * info.total_size() if info else status.all_time_download,
        }))

        if status.progress == 1:
            cancel_download()

        time.sleep(0.5)

def listen_to_socket():
    while True:
        msg = read_fifo.recv(1024 * 2)
        payload = json.loads(msg.decode("utf-8"))

        if payload['action'] == "start":
            start_download(payload['game_id'], payload['magnet'], payload['save_path'])
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
