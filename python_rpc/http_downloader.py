import aria2p
from aria2p.client import ClientException
import os

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
        if self.download:
            self.aria2.resume([self.download])
        else:
            downloads = self.aria2.add(url, options={"header": header, "dir": save_path, "out": out})
            
            self.download = downloads[0]
    
    def pause_download(self):
        if self.download:
            self.aria2.pause([self.download])
    
    def cancel_download(self):
        if self.download:
            download_ref = self.download  # Save reference before clearing
            try:
                self.aria2.remove([download_ref])
                self.download = None
            except Exception:
                # Try to remove control file manually if aria2p fails
                try:
                    if hasattr(download_ref, 'control_file_path') and download_ref.control_file_path:
                        control_file = download_ref.control_file_path
                        if control_file.exists():
                            # Handle Windows path issues with invalid characters
                            try:
                                control_file.unlink(missing_ok=True)
                            except OSError:
                                # Try to rename and delete if path contains invalid characters
                                try:
                                    temp_path = str(control_file) + ".tmp"
                                    if os.path.exists(str(control_file)):
                                        os.rename(str(control_file), temp_path)
                                        os.remove(temp_path)
                                except Exception:
                                    pass
                except Exception:
                    pass
                finally:
                    self.download = None

    def get_download_status(self):
        if self.download == None:
            return None

        try:
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
        except ClientException:
            # Download was removed or completed, clear the reference
            self.download = None
            return None
        except Exception:
            return None
