import libtorrent as lt

class TorrentDownloader:
    def __init__(self, torrent_session, flags = lt.torrent_flags.auto_managed):
        self.torrent_handle = None
        self.session = torrent_session
        self.flags = flags
        self.cached_file_size = None  # Cache for selected files size
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

    def _wait_for_metadata(self, timeout_seconds=30):
        """Wait for torrent metadata to become available."""
        import time
        max_iterations = int(timeout_seconds / 0.25)
        
        for i in range(max_iterations):
            if self.torrent_handle.status().has_metadata:
                print(f"[torrent] Metadata available after {i * 0.25:.2f}s")
                return True
            time.sleep(0.25)
        
        print("[torrent] WARNING: Metadata not available after 30s, downloading all files")
        return False
    
    def _set_file_priorities(self, file_indices):
        """Set file priorities for selective download."""
        info = self.torrent_handle.get_torrent_info()
        num_files = info.num_files()
        print(f"[torrent] Torrent has {num_files} files total")
        print(f"[torrent] Setting priorities for file indices: {file_indices}")
        
        # Set all files to priority 0 (don't download) first
        for i in range(num_files):
            self.torrent_handle.file_priority(i, 0)
        
        # Then set selected files to priority 4 (normal download)
        selected_file_sizes = []
        for idx in file_indices:
            if 0 <= idx < num_files:
                self.torrent_handle.file_priority(idx, 4)
                file_info = info.file_at(idx)
                file_size = file_info.size
                selected_file_sizes.append(file_size)
                print(f"[torrent] File {idx}: {file_info.path} - Size: {file_size} bytes - Priority set to 4 (download)")
            else:
                print(f"[torrent] WARNING: File index {idx} out of range (0-{num_files-1})")
        
        # Calculate cached size from the files we just set
        self.cached_file_size = sum(selected_file_sizes)
        print("[torrent] File priorities set successfully.")
        print(f"[torrent] Total size of selected files: {self.cached_file_size} bytes ({self.cached_file_size / (1024**3):.2f} GB)")

    def start_download(self, magnet: str, save_path: str, file_indices=None):
        # Add torrent initially paused to prevent auto-download before setting priorities
        temp_flags = self.flags
        if file_indices is not None and len(file_indices) > 0:
            temp_flags = lt.torrent_flags.paused | lt.torrent_flags.auto_managed
        
        params = {'url': magnet, 'save_path': save_path, 'trackers': self.trackers, 'flags': temp_flags}
        self.torrent_handle = self.session.add_torrent(params)
        
        # If file_indices is provided, wait for metadata then set file priorities
        if file_indices is not None and len(file_indices) > 0:
            print(f"[torrent] Selective download requested for {len(file_indices)} files")
            print(f"[torrent] File indices to download: {file_indices}")
            
            if self._wait_for_metadata():
                self._set_file_priorities(file_indices)
        
        # Resume the torrent to start downloading
        self.torrent_handle.resume()

    def get_files(self):
        """Get list of files in the torrent"""
        if self.torrent_handle is None:
            return None
        
        info = self.torrent_handle.get_torrent_info()
        if not info:
            return None
        
        files = []
        for i in range(info.num_files()):
            file = info.file_at(i)
            files.append({
                'index': i,
                'name': file.path,
                'size': file.size,
                'priority': self.torrent_handle.file_priority(i)
            })
        
        return files

    def pause_download(self):
        if self.torrent_handle:
            self.torrent_handle.pause()
            self.torrent_handle.unset_flags(lt.torrent_flags.auto_managed)

    def cancel_download(self):
        if self.torrent_handle:
            self.torrent_handle.pause()
            self.session.remove_torrent(self.torrent_handle)
            self.torrent_handle = None

    def abort_session(self):
        for game_id in self.torrent_handles:
            self.torrent_handle = self.torrent_handles[game_id]
            self.torrent_handle.pause()
            self.session.remove_torrent(self.torrent_handle)
            
        self.session.abort()
        self.torrent_handle = None

    def get_download_status(self):
        if self.torrent_handle is None:
            return None

        status = self.torrent_handle.status()
        info = self.torrent_handle.get_torrent_info()

        # Delegate file size computation to helper to reduce cognitive complexity
        file_size = self._calculate_file_size() if info else 0

        response = {
            'folderName': info.name() if info else "",
            'fileSize': file_size,
            'progress': status.progress,
            'downloadSpeed': status.download_rate,
            'uploadSpeed': status.upload_rate,
            'numPeers': status.num_peers,
            'numSeeds': status.num_seeds,
            'status': status.state,
            'bytesDownloaded': (status.progress * file_size) if info else status.all_time_download,
        }

        return response

    def _calculate_file_size(self):
        """Helper to calculate and cache file size based on file priorities."""
        if self.torrent_handle is None:
            return 0

        info = self.torrent_handle.get_torrent_info()
        if not info:
            return 0

        if self.cached_file_size is not None and self.cached_file_size > 0:
            return self.cached_file_size

        file_size = 0
        for i in range(info.num_files()):
            try:
                if self.torrent_handle.file_priority(i) > 0:
                    file_size += info.file_at(i).size
            except Exception:
                continue
        if file_size == 0:
            try:
                file_size = info.total_size()
            except Exception:
                file_size = 0

        self.cached_file_size = file_size
        return file_size
