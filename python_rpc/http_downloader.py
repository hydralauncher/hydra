import aria2p
import logging

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
        self.logger = logging.getLogger(__name__)
        logging.basicConfig(level=logging.INFO)

    def start_download(self, url: str, save_path: str, header: str, out: str = None):
        """Inicia ou retoma o download."""
        if self.download:
            try:
                self.aria2.resume([self.download])
                self.logger.info(f"Resumed download: {url}")
            except Exception as e:
                self.logger.error(f"Failed to resume download: {e}")
        else:
            try:
                downloads = self.aria2.add(url, options={"header": header, "dir": save_path, "out": out})
                self.download = downloads[0]
                self.logger.info(f"Started download: {url}")
            except Exception as e:
                self.logger.error(f"Failed to start download: {e}")
    
    def pause_download(self):
        """Pausa o download atual."""
        if self.download:
            try:
                self.aria2.pause([self.download])
                self.logger.info(f"Paused download: {self.download.gid}")
            except Exception as e:
                self.logger.error(f"Failed to pause download: {e}")
    
    def cancel_download(self):
        """Cancela o download atual."""
        if self.download:
            try:
                self.aria2.remove([self.download])
                self.download = None
                self.logger.info("Download canceled and removed.")
            except Exception as e:
                self.logger.error(f"Failed to cancel download: {e}")

    def get_download_status(self):
        """Retorna o status do download atual."""
        if not self.download:
            self.logger.warning("No download in progress.")
            return None

        try:
            download = self.aria2.get_download(self.download.gid)

            response = {
                'folderName': download.name,
                'fileSize': download.total_length,
                'progress': download.completed_length / download.total_length if download.total_length else 0,
                'downloadSpeed': download.download_speed,
                'numPeers': download.num_peers,
                'numSeeds': download.num_seeds,
                'status': download.status,
                'bytesDownloaded': download.completed_length,
            }

            return response
        except Exception as e:
            self.logger.error(f"Failed to get download status: {e}")
            return None
