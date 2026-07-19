import logging
import threading
import time
from typing import List, Optional, Set

import libtorrent as lt


class TorrentDownloader:
    def __init__(
        self,
        torrent_session,
        flags=lt.torrent_flags.auto_managed,
        session_lock: Optional[threading.RLock] = None,
    ):
        self.torrent_handle = None
        self.session = torrent_session
        self.flags = flags
        self.session_lock = session_lock or threading.RLock()
        self.selected_file_indices = None
        self.selected_size_bytes = None
        self.logger = logging.getLogger("hydra.torrent")
        self.trackers = [
            "udp://zer0day.ch:1337/announce",
            "udp://tracker.publictracker.xyz:6969/announce",
            "http://tracker.opentrackr.org:1337/announce",
            "udp://open.demonii.com:1337/announce",
            "udp://open.tracker.cl:1337/announce",
            "udp://open.stealth.si:80/announce",
            "http://open.tracker.cl:1337/announce",
            "udp://tracker2.dler.org:80/announce",
            "udp://tracker.wildkat.net:6969/announce",
            "udp://tracker.torrent.eu.org:451/announce",
            "udp://tracker.qu.ax:6969/announce",
            "udp://tracker.opentorrent.top:6969/announce",
            "udp://tracker.ducks.party:1984/announce",
            "udp://tracker.auctor.tv:6969/announce",
            "udp://tracker-udp.gbitt.info:80/announce",
            "udp://tr4ck3r.duckdns.org:6969/announce",
            "udp://torrentclub.online:54123/announce",
            "udp://t.overflow.biz:6969/announce",
            "udp://seedpeer.net:6969/announce",
            "udp://retracker01-msk-virt.corbina.net:80/announce",
            "udp://rekcart.duckdns.org:15480/announce",
            "udp://open.demonoid.ch:6969/announce",
            "udp://ns575949.ip-51-222-82.net:6969/announce",
            "udp://ipv4announce.sktorrent.eu:6969/announce",
            "udp://explodie.org:6969/announce",
            "udp://exodus.desync.com:6969/announce",
            "udp://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce",
            "https://tracker.zhuqiy.com:443/announce",
            "https://tracker.yemekyedim.com:443/announce",
            "https://tracker.pmman.tech:443/announce",
            "https://tracker.nekomi.cn:443/announce",
            "https://tracker.leechshield.link:443/announce",
            "https://tracker.bt4g.com:443/announce",
            "https://tracker.7471.top:443/announce",
            "https://tr.zukizuki.org:443/announce",
            "https://tr.nyacat.pw:443/announce",
            "https://shahidrazi.online:443/announce",
            "https://open.ftorrent.com:443/announce",
            "http://tracker.zhuqiy.com:80/announce",
            "http://tracker.waaa.moe:6969/announce",
            "http://tracker.renfei.net:8080/announce",
            "http://tracker.qu.ax:6969/announce",
            "http://tracker.privateseedbox.xyz:2710/announce",
            "http://tracker.mywaifu.best:6969/announce",
            "http://tracker.dler.org:6969/announce",
            "http://tracker.dler.com:6969/announce",
            "http://tracker.dhitechnical.com:6969/announce",
            "http://tracker.bt4g.com:2095/announce",
            "http://tr.nyacat.pw:80/announce",
            "http://tr.kxmp.cf:80/announce",
            "http://tr.highstar.shop:80/announce",
            "http://t.overflow.biz:6969/announce",
            "http://lucke.fenesisu.moe:6969/announce",
            "http://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce",
            "http://aboutbeautifulgallopinghorsesinthegreenpasture.online:80/announce",
            "http://1337.abcvg.info:80/announce",
            "http://004430.xyz:80/announce",
            "udp://tracker.theoks.net:6969/announce",
            "udp://tracker.skynetcloud.site:6969/announce",
            "udp://tracker.playground.ru:6969/announce",
            "udp://tracker.peerfect.org:6969/announce",
            "udp://tracker.nyaa.vc:6969/announce",
            "udp://tracker.gmi.gd:6969/announce",
            "udp://tracker.dler.org:6969/announce",
            "udp://tracker.ddunlimited.net:6969/announce",
            "udp://tracker.corpscorp.online:80/announce",
            "udp://tracker.bittor.pw:1337/announce",
            "udp://open.ftorrent.com:443/announce",
            "udp://martin-gebhardt.eu:25/announce",
            "udp://leet-tracker.moe:1337/announce",
            "udp://evan.im:6969/announce",
            "udp://admin.52ywp.com:6969/announce",
            "https://t.213891.xyz:443/announce",
            "https://pybittrack.retiolus.net:443/announce",
            "http://tracker2.dler.org:80/announce",
        ]

    def set_trackers(self, trackers: Optional[List[str]] = None):
        if not trackers:
            return

        entries = []
        for url in trackers:
            e = lt.announce_entry(url)
            e.tier = 0
            entries.append(e)

        for url in self.trackers:
            e = lt.announce_entry(url)
            e.tier = 1
            entries.append(e)

        with self.session_lock:
            if self.torrent_handle and self.torrent_handle.is_valid():
                self.torrent_handle.replace_trackers(entries)
                self.torrent_handle.post_trackers()

    def set_download_limit(self, max_download_speed: int = None):
        download_limit = max_download_speed if (max_download_speed or 0) > 0 else 0
        try:
            self.session.apply_settings({"download_rate_limit": download_limit})
        except RuntimeError as error:
            self.logger.error("Failed to apply download rate limit: %s", error)

    def _wait_for_metadata(self, timeout_seconds: float = 30.0, poll_interval: float = 0.25):
        if not self.torrent_handle or not self.torrent_handle.is_valid():
            return False

        deadline = time.monotonic() + max(timeout_seconds, 1.0)

        while time.monotonic() < deadline:
            try:
                status = self.torrent_handle.status()
            except RuntimeError:
                return False

            if status.has_metadata:
                return True

            time.sleep(max(poll_interval, 0.05))

        return False

    def wait_for_metadata(self, timeout_seconds: float = 30.0):
        return self._wait_for_metadata(timeout_seconds=timeout_seconds)

    def _sanitize_file_indices(self, file_indices: List[int], files_storage):
        if file_indices is None:
            return None

        if not isinstance(file_indices, list):
            raise ValueError("invalid_file_indices")

        max_index = files_storage.num_files() - 1
        sanitized: Set[int] = set()

        for index in file_indices:
            if isinstance(index, bool) or not isinstance(index, int):
                raise ValueError("invalid_file_indices")

            if index < 0 or index > max_index:
                raise ValueError("invalid_file_indices")

            sanitized.add(index)

        if not sanitized:
            raise ValueError("empty_selection")

        return sorted(sanitized)

    def _set_selected_file_priorities(self, selected_indices: List[int], files_storage):
        priorities = [0] * files_storage.num_files()
        for index in selected_indices:
            priorities[index] = 1

        self.torrent_handle.prioritize_files(priorities)

        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline:
            try:
                current_priorities = [int(priority) for priority in self.torrent_handle.get_file_priorities()]
            except RuntimeError:
                break

            if current_priorities == priorities:
                return

            time.sleep(0.1)

        self.logger.warning("File priority synchronization timeout")

    def start_download(
        self,
        magnet: str,
        save_path: str,
        file_indices: Optional[List[int]] = None,
        trackers: Optional[List[str]] = None,
        wait_timeout_seconds: float = 30.0,
    ):
        selective_download = file_indices is not None

        with self.session_lock:
            if self.torrent_handle and self.torrent_handle.is_valid():
                if not selective_download:
                    self.torrent_handle.set_flags(lt.torrent_flags.auto_managed)
                    self.torrent_handle.resume()
                    return

                self.torrent_handle.pause()
                self.session.remove_torrent(self.torrent_handle)
                self.torrent_handle = None

            initial_flags = self.flags | lt.torrent_flags.paused

            if selective_download:
                initial_flags |= lt.torrent_flags.default_dont_download
                initial_flags |= lt.torrent_flags.auto_managed
            else:
                initial_flags |= lt.torrent_flags.auto_managed

            atp = lt.parse_magnet_uri(magnet)
            atp.save_path = save_path
            atp.trackers = self.trackers + (trackers or [])
            atp.flags = initial_flags

            if self.torrent_handle is None or not self.torrent_handle.is_valid():
                self.torrent_handle = self.session.add_torrent(atp)
                if trackers:
                    entries = []
                    for url in trackers:
                        e = lt.announce_entry(url)
                        e.tier = 0
                        entries.append(e)
                    for url in self.trackers:
                        e = lt.announce_entry(url)
                        e.tier = 1
                        entries.append(e)
                    self.torrent_handle.replace_trackers(entries)
                    self.torrent_handle.post_trackers()

        self.selected_file_indices = None
        self.selected_size_bytes = None

        if selective_download:
            try:
                self.torrent_handle.set_flags(lt.torrent_flags.auto_managed)
                self.torrent_handle.resume()

                if not self._wait_for_metadata(timeout_seconds=wait_timeout_seconds):
                    raise TimeoutError("metadata_timeout")

                try:
                    info = self.torrent_handle.torrent_file()
                    if info is None:
                        raise RuntimeError("metadata_incomplete")
                    files_storage = info.files()
                except RuntimeError as error:
                    raise RuntimeError("metadata_incomplete") from error

                self.torrent_handle.pause()
                self.torrent_handle.unset_flags(lt.torrent_flags.auto_managed)

                sanitized_indices = self._sanitize_file_indices(file_indices, files_storage)
                self._set_selected_file_priorities(sanitized_indices, files_storage)

                self.selected_file_indices = sanitized_indices
                self.selected_size_bytes = sum(files_storage.file_size(index) for index in sanitized_indices)
            except Exception:
                self.cancel_download()
                raise

        self.torrent_handle.set_flags(lt.torrent_flags.auto_managed)
        self.torrent_handle.resume()

    def get_torrent_files(self, timeout_seconds: float = 30.0, max_files: int = 100000):
        if not self._wait_for_metadata(timeout_seconds=timeout_seconds):
            raise TimeoutError("metadata_timeout")

        try:
            info = self.torrent_handle.torrent_file()
            if info is None:
                raise RuntimeError("metadata_incomplete")
        except RuntimeError as error:
            raise RuntimeError("metadata_incomplete") from error

        files_storage = info.files()
        file_count = files_storage.num_files()

        if file_count > max_files:
            raise OverflowError("too_many_files")

        files = []
        for index in range(file_count):
            files.append(
                {
                    "index": index,
                    "path": files_storage.file_path(index),
                    "length": files_storage.file_size(index),
                }
            )

        return {
            "name": info.name(),
            "totalSize": info.total_size(),
            "files": files,
        }

    def pause_download(self):
        if self.torrent_handle:
            self.torrent_handle.pause()
            self.torrent_handle.unset_flags(lt.torrent_flags.auto_managed)

    def cancel_download(self):
        with self.session_lock:
            if self.torrent_handle:
                if self.torrent_handle.is_valid():
                    self.torrent_handle.pause()
                    self.session.remove_torrent(self.torrent_handle, lt.session.delete_partfile)
                self.torrent_handle = None
                self.selected_file_indices = None
                self.selected_size_bytes = None

    def abort_session(self):
        self.cancel_download()
        self.session.abort()
        self.torrent_handle = None
        self.selected_file_indices = None
        self.selected_size_bytes = None

    def _get_handle_status(self):
        if self.torrent_handle is None:
            return None

        if not self.torrent_handle.is_valid():
            return None

        try:
            return self.torrent_handle.status()
        except RuntimeError:
            return None

    def _get_torrent_info_if_available(self, status):
        if not status.has_metadata:
            return None

        try:
            return self.torrent_handle.torrent_file()
        except RuntimeError:
            return None

    def _get_file_size(self, status, info):
        total_wanted = getattr(status, "total_wanted", 0)
        if total_wanted > 0:
            return total_wanted

        if self.selected_size_bytes is not None:
            return self.selected_size_bytes

        if info:
            return info.total_size()

        return 0

    def _get_bytes_downloaded(self, status, file_size):
        total_wanted_done = getattr(status, "total_wanted_done", -1)
        if total_wanted_done >= 0:
            return total_wanted_done

        if file_size > 0:
            return int(status.progress * file_size)

        return status.all_time_download

    def _get_progress(self, status, file_size, bytes_downloaded):
        if file_size <= 0:
            return status.progress

        return min(max(bytes_downloaded / file_size, 0), 1)

    def get_download_status(self):
        status = self._get_handle_status()
        if status is None:
            return None

        info = self._get_torrent_info_if_available(status)
        file_size = self._get_file_size(status, info)
        bytes_downloaded = self._get_bytes_downloaded(status, file_size)
        progress = self._get_progress(status, file_size, bytes_downloaded)

        response = {
            'folderName': info.name() if info else "",
            'fileSize': file_size,
            'progress': progress,
            'downloadSpeed': status.download_rate,
            'uploadSpeed': status.upload_rate,
            'numPeers': status.num_peers,
            'numSeeds': status.num_seeds,
            'status': status.state,
            'bytesDownloaded': bytes_downloaded,
        }

        return response
