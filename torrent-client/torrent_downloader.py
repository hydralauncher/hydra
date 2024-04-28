import libtorrent as lt

class TorrentDownloader:
    torrent_handler = None

    def __init__(self, port):
        self.session = lt.session({'listen_interfaces': '0.0.0.0:{port}'.format(port=port)})

    def get_handler(self):
        return self.torrent_handler
    
    def start_download(self, magnet, save_path):
        params = {'url': magnet, 'save_path': save_path}
        self.torrent_handler = self.session.add_torrent(params)
        self.torrent_handler.set_flags(lt.torrent_flags.auto_managed)
        self.torrent_handler.resume()

    def pause_download(self):
        self.torrent_handler.pause()
        self.torrent_handler.unset_flags(lt.torrent_flags.auto_managed)

    def cancel_download(self):
        self.torrent_handler.pause()
        self.session.remove_torrent(self.torrent_handler)
        self.torrent_handler = None

    def get_status(self, downloading_game_id):
        info = self.torrent_handler.get_torrent_info()
        status = self.torrent_handler.status()
        return {
            'folderName': info.name() if info else "",
            'fileSize': info.total_size() if info else 0,
            'gameId': downloading_game_id,
            'progress': status.progress,
            'downloadSpeed': status.download_rate,
            'timeRemaining': self.__get_eta(status),
            'numPeers': status.num_peers,
            'numSeeds': status.num_seeds,
            'status': status.state,
            'bytesDownloaded': status.progress * info.total_size() if info else status.all_time_download,
        }
    
    def __get_eta(self, status):
        remaining_bytes = status.total_wanted - status.total_wanted_done

        if remaining_bytes >= 0 and status.download_rate > 0:
            return (remaining_bytes / status.download_rate) * 1000
        else:
            return 1
