import libtorrent as lt

class Downloader:
    def __init__(self, port: str):
        self.torrent_handles = {}
        self.downloading_game_id = -1
        self.session = lt.session({'listen_interfaces': '0.0.0.0:{port}'.format(port=port)})

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

    def cancel_all_downloads(self):
        for game_id in self.torrent_handles:
            torrent_handle = self.torrent_handles[game_id]
            torrent_handle.pause()
            self.session.remove_torrent(torrent_handle)

        self.torrent_handles = {}
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
