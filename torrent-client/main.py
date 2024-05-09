import asyncio
import json
import sys
import time

import libtorrent as lt
from fifo import Fifo

torrent_port = sys.argv[1]
read_sock_path = sys.argv[2]
write_sock_path = sys.argv[3]

class SessionSingleton:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.session = lt.session({'listen_interfaces': '0.0.0.0:{port}'.format(port=torrent_port)})
        return cls._instance

    def get_session(self):
        return self.session

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

async def get_download_updates():
    global torrent_handle
    global downloading_game_id

    while True:
        if downloading_game_id == 0:
            await asyncio.sleep(0.5)
            continue

        session = SessionSingleton().get_session()
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

        await asyncio.sleep(0.5)

async def listen_to_socket():
    global torrent_handle
    global downloading_game_id

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

async def start_download(game_id: int, magnet: str, save_path: str):
    global torrent_handle
    global downloading_game_id

    session = SessionSingleton().get_session()
    params = {'url': magnet, 'save_path': save_path}
    torrent_handle = session.add_torrent(params)
    downloading_game_id = game_id
    torrent_handle.set_flags(lt.torrent_flags.auto_managed)
    torrent_handle.resume()

async def pause_download():
    global downloading_game_id

    if torrent_handle:
        torrent_handle.pause()
        torrent_handle.unset_flags(lt.torrent_flags.auto_managed)
        downloading_game_id = 0

async def cancel_download():
    global downloading_game_id
    global torrent_handle

    if torrent_handle:
        torrent_handle.pause()
        session = SessionSingleton().get_session()
        session.remove_torrent(torrent_handle)
        torrent_handle = None
        downloading_game_id = 0

if __name__ == "__main__":
    asyncio.run(asyncio.gather(get_download_updates(), listen_to_socket()))
