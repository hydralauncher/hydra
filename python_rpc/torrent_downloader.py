import libtorrent as lt

class TorrentDownloader:
    def __init__(self, torrent_session, flags = lt.torrent_flags.auto_managed):
        self.torrent_handle = None
        self.session = torrent_session
        self.flags = flags
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

    def start_download(self, magnet: str, save_path: str, header: str):
        params = {'url': magnet, 'save_path': save_path, 'trackers': self.trackers, 'flags': self.flags}
        self.torrent_handle = self.session.add_torrent(params)
        self.torrent_handle.resume()

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
        
        response = {
            'folderName': info.name() if info else "",
            'fileSize': info.total_size() if info else 0,
            'progress': status.progress,
            'downloadSpeed': status.download_rate,
            'uploadSpeed': status.upload_rate,
            'numPeers': status.num_peers,
            'numSeeds': status.num_seeds,
            'status': status.state,
            'bytesDownloaded': status.progress * info.total_size() if info else status.all_time_download,
        }

        return response
