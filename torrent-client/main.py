import libtorrent as lt
import sys
from fifo import Fifo
import json
import threading
import time

def get_eta(status):
    remaining_bytes = status.total_wanted - status.total_wanted_done

    if remaining_bytes >= 0 and status.download_rate > 0:
        return (remaining_bytes / status.download_rate) * 1000
    else:
        return 1

def start_download(session, game_id: int, magnet: str, save_path: str):
    params = {'url': magnet, 'save_path': save_path}
    torrent_handle = session.add_torrent(params)
    torrent_handle.set_flags(lt.torrent_flags.auto_managed)
    torrent_handle.resume()
    return torrent_handle

def pause_download(torrent_handle):
    if torrent_handle:
        torrent_handle.pause()
        torrent_handle.unset_flags(lt.torrent_flags.auto_managed)

def cancel_download(session, torrent_handle):
    if torrent_handle:
        torrent_handle.pause()
        session.remove_torrent(torrent_handle)

def get_download_updates(torrent_handle, downloading_game_id, write_fifo):
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
            cancel_download(session, torrent_handle)
            break

        time.sleep(0.5)

def listen_to_socket(session, read_fifo, write_fifo):
    downloading_game_id = 0
    torrent_handle = None
    while True:
        msg = read_fifo.recv(1024 * 2)
        payload = json.loads(msg.decode("utf-8"))

        if payload['action'] == "start":
            torrent_handle = start_download(session, payload['game_id'], payload['magnet'], payload['save_path'])
            downloading_game_id = payload['game_id']
        elif payload['action'] == "pause":
            pause_download(torrent_handle)
        elif payload['action'] == "cancel":
            cancel_download(session, torrent_handle)
            downloading_game_id = 0

if __name__ == "__main__":
    torrent_port = sys.argv[1]
    read_sock_path = sys.argv[2]
    write_sock_path = sys.argv[3]

    session = lt.session({'listen_interfaces': '0.0.0.0:{port}'.format(port=torrent_port)})
    read_fifo = Fifo(read_sock_path)
    write_fifo = Fifo(write_sock_path)

    p1 = threading.Thread(target=get_download_updates, args=(None, 0, write_fifo))
    p2 = threading.Thread(target=listen_to_socket, args=(session, read_fifo, write_fifo))

    p1.start()
    p2.start()
