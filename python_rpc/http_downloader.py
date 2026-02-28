import aria2p
from aria2p.client import ClientException as DownloadNotFound

class HttpDownloader:
    def __init__(self):
        self.download = None
        self.max_download_speed = None
        self.aria2 = aria2p.API(
            aria2p.Client(
                host="http://localhost",
                port=6800,
                secret=""
            )
        )

    def set_download_limit(self, max_download_speed: int = None):
        self.max_download_speed = max_download_speed if max_download_speed and max_download_speed > 0 else None
        speed_limit = str(self.max_download_speed) if self.max_download_speed else "0"
        try:
            self.aria2.set_global_options({"max-overall-download-limit": speed_limit})
        except Exception:
            pass

    def start_download(self, url: str, save_path: str, header, out: str = None):
        if self.download:
            self.aria2.resume([self.download])
        else:
            options = {"dir": save_path}
            if self.max_download_speed:
                options["max-download-limit"] = str(self.max_download_speed)
            if header:
                options["header"] = header
            if out:
                options["out"] = out
            downloads = self.aria2.add(url, options=options)
            self.download = downloads[0]
    
    def pause_download(self):
        if self.download:
            self.aria2.pause([self.download])
    
    def cancel_download(self):
        if self.download:
            self.aria2.remove([self.download])
            self.download = None

    def get_download_status(self):
        if self.download == None:
            return None

        try:
            download = self.aria2.get_download(self.download.gid)
        except DownloadNotFound:
            self.download = None
            return None

        response = {
            'folderName': download.name,
            'fileSize': download.total_length,
            'progress': download.completed_length / download.total_length if download.total_length else 0,
            'downloadSpeed': download.download_speed,
            'numPeers': 0,
            'numSeeds': 0,
            'status': download.status,
            'bytesDownloaded': download.completed_length,
        }

        return response
