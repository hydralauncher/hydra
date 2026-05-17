import threading
from typing import List, Optional


class TorrentDownloader:
    """Stub — BitTorrent engine removed. Downloads are handled by JsHttpDownloader in Node.js."""

    def __init__(self, torrent_session=None, flags=None, session_lock=None):
        self.session_lock = session_lock or threading.RLock()
        self.selected_file_indices = None
        self.selected_size_bytes = None

    def set_download_limit(self, max_download_speed: Optional[int] = None) -> None:
        pass

    def start_download(
        self,
        magnet: str,
        save_path: str,
        file_indices: Optional[List[int]] = None,
        wait_timeout_seconds: float = 30.0,
    ) -> None:
        raise NotImplementedError("torrent_downloads_disabled")

    def get_torrent_files(
        self, timeout_seconds: float = 30.0, max_files: int = 100000
    ):
        raise NotImplementedError("torrent_downloads_disabled")

    def pause_download(self) -> None:
        pass

    def cancel_download(self) -> None:
        pass

    def abort_session(self) -> None:
        pass

    def get_download_status(self):
        return None
