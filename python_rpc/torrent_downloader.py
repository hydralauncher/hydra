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
            "udp://tracker.opentrackr.org:1337/announce",
            "http://tracker.opentrackr.org:1337/announce",
            "udp://open.tracker.cl:1337/announce",
            "udp://open.demonii.com:1337/announce",
            "udp://open.stealth.si:80/announce",
            "udp://tracker.torrent.eu.org:451/announce",
            "udp://exodus.desync.com:6969/announce",
            "udp://tracker.theoks.net:6969/announce",
            "udp://tracker-udp.gbitt.info:80/announce",
            "udp://explodie.org:6969/announce",
            "https://tracker.tamersunion.org:443/announce",
            "udp://tracker2.dler.org:80/announce",
            "udp://tracker1.myporn.club:9337/announce",
            "udp://tracker.tiny-vps.com:6969/announce",
            "udp://tracker.dler.org:6969/announce",
            "udp://tracker.bittor.pw:1337/announce",
            "udp://tracker.0x7c0.com:6969/announce",
            "udp://retracker01-msk-virt.corbina.net:80/announce",
            "udp://opentracker.io:6969/announce",
            "udp://open.free-tracker.ga:6969/announce",
            "udp://new-line.net:6969/announce",
            "udp://moonburrow.club:6969/announce",
            "udp://leet-tracker.moe:1337/announce",
            "udp://bt2.archive.org:6969/announce",
            "udp://bt1.archive.org:6969/announce",
            "http://tracker2.dler.org:80/announce",
            "http://tracker1.bt.moack.co.kr:80/announce",
            "http://tracker.dler.org:6969/announce",
            "http://tr.kxmp.cf:80/announce",
            "udp://u.peer-exchange.download:6969/announce",
            "udp://ttk2.nbaonlineservice.com:6969/announce",
            "udp://tracker.tryhackx.org:6969/announce",
            "udp://tracker.srv00.com:6969/announce",
            "udp://tracker.skynetcloud.site:6969/announce",
            "udp://tracker.jamesthebard.net:6969/announce",
            "udp://tracker.fnix.net:6969/announce",
            "udp://tracker.filemail.com:6969/announce",
            "udp://tracker.farted.net:6969/announce",
            "udp://tracker.edkj.club:6969/announce",
            "udp://tracker.dump.cl:6969/announce",
            "udp://tracker.deadorbit.nl:6969/announce",
            "udp://tracker.darkness.services:6969/announce",
            "udp://tracker.ccp.ovh:6969/announce",
            "udp://tamas3.ynh.fr:6969/announce",
            "udp://ryjer.com:6969/announce",
            "udp://run.publictracker.xyz:6969/announce",
            "udp://public.tracker.vraphim.com:6969/announce",
            "udp://p4p.arenabg.com:1337/announce",
            "udp://p2p.publictracker.xyz:6969/announce",
            "udp://open.u-p.pw:6969/announce",
            "udp://open.publictracker.xyz:6969/announce",
            "udp://open.dstud.io:6969/announce",
            "udp://open.demonoid.ch:6969/announce",
            "udp://odd-hd.fr:6969/announce",
            "udp://martin-gebhardt.eu:25/announce",
            "udp://jutone.com:6969/announce",
            "udp://isk.richardsw.club:6969/announce",
            "udp://evan.im:6969/announce",
            "udp://epider.me:6969/announce",
            "udp://d40969.acod.regrucolo.ru:6969/announce",
            "udp://bt.rer.lol:6969/announce",
            "udp://amigacity.xyz:6969/announce",
            "udp://1c.premierzal.ru:6969/announce",
            "https://trackers.run:443/announce",
            "https://tracker.yemekyedim.com:443/announce",
            "https://tracker.renfei.net:443/announce",
            "https://tracker.pmman.tech:443/announce",
            "https://tracker.lilithraws.org:443/announce",
            "https://tracker.imgoingto.icu:443/announce",
            "https://tracker.cloudit.top:443/announce",
            "https://tracker-zhuqiy.dgj055.icu:443/announce",
            "http://tracker.renfei.net:8080/announce",
            "http://tracker.mywaifu.best:6969/announce",
            "http://tracker.ipv6tracker.org:80/announce",
            "http://tracker.files.fm:6969/announce",
            "http://tracker.edkj.club:6969/announce",
            "http://tracker.bt4g.com:2095/announce",
            "http://tracker-zhuqiy.dgj055.icu:80/announce",
            "http://t1.aag.moe:17715/announce",
            "http://t.overflow.biz:6969/announce",
            "http://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce",
            "udp://torrents.artixlinux.org:6969/announce",
            "udp://mail.artixlinux.org:6969/announce",
            "udp://ipv4.rer.lol:2710/announce",
            "udp://concen.org:6969/announce",
            "udp://bt.rer.lol:2710/announce",
            "udp://aegir.sexy:6969/announce",
            "https://www.peckservers.com:9443/announce",
            "https://tracker.ipfsscan.io:443/announce",
            "https://tracker.gcrenwp.top:443/announce",
            "http://www.peckservers.com:9000/announce",
            "http://tracker1.itzmx.com:8080/announce",
            "http://ch3oh.ru:6969/announce",
            "http://bvarf.tracker.sh:2086/announce",
        ]

    def set_download_limit(self, max_download_speed: int = None):
        download_limit = (
            max_download_speed if max_download_speed and max_download_speed > 0 else 0
        )
        try:
            self.session.set_download_rate_limit(download_limit)
        except Exception:
            pass

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

            params = {
                "url": magnet,
                "save_path": save_path,
                "trackers": self.trackers,
                "flags": initial_flags,
            }

            if self.torrent_handle is None or not self.torrent_handle.is_valid():
                self.torrent_handle = self.session.add_torrent(params)

        self.selected_file_indices = None
        self.selected_size_bytes = None

        if selective_download:
            try:
                self.torrent_handle.set_flags(lt.torrent_flags.auto_managed)
                self.torrent_handle.resume()

                if not self._wait_for_metadata(timeout_seconds=wait_timeout_seconds):
                    raise TimeoutError("metadata_timeout")

                try:
                    info = self.torrent_handle.get_torrent_info()
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
            info = self.torrent_handle.get_torrent_info()
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
            return self.torrent_handle.get_torrent_info()
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
