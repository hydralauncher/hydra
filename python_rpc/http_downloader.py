import aria2p


class Aria2ServiceNotRunningError(Exception):
    """Raised when aria2 service is not running."""


class FilenameTooLongError(Exception):
    """Raised when filename is too long for macOS."""


class HttpDownloader:
    def __init__(self):
        self.download = None
        self.aria2 = aria2p.API(
            aria2p.Client(
                host="http://localhost",
                port=6800,
                secret=""
            )
        )

    def start_download(self, url: str, save_path: str, header: str, out: str = None):
        try:
            if self.download:
                self.aria2.resume([self.download])
            else:
                options = {"header": header, "dir": save_path}
                
                # macOS has a 255-byte filename limit, truncate if needed
                if out:
                    if len(out.encode('utf-8')) > 200:
                        import os
                        name, ext = os.path.splitext(out)
                        # Truncate to fit within 200 bytes total
                        max_name_len = 200 - len(ext.encode('utf-8'))
                        truncated_name = name.encode('utf-8')[:max_name_len].decode('utf-8', 'ignore')
                        out = truncated_name + ext
                    options["out"] = out
                
                downloads = self.aria2.add(url, options=options)
                
                self.download = downloads[0]
        except Exception as e:
            error_msg = str(e)
            if "Connection refused" in error_msg or "Failed to connect" in error_msg or "6800" in error_msg:
                raise Aria2ServiceNotRunningError("Aria2 download service is not running. Please restart the application.") from e
            if "File name too long" in error_msg or "ENAMETOOLONG" in error_msg or "[Errno 63]" in error_msg:
                raise FilenameTooLongError("Filename is too long for macOS. Please try a different download source or contact support.") from e
            raise
    
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

        download = self.aria2.get_download(self.download.gid)

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
