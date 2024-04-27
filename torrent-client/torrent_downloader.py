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
