import asyncio
import aria2p
from typing import Optional


class HttpDownloader:
    def __init__(self):
        self.download: Optional[aria2p.Download] = None
        self._aria2: Optional[aria2p.API] = None
        self._lock = asyncio.Lock()

    @property
    def aria2(self) -> aria2p.API:
        if self._aria2 is None:
            self._aria2 = aria2p.API(
                aria2p.Client(
                    host="http://localhost",
                    port=6800,
                    secret=""
                )
            )
        return self._aria2

    async def start_download(self, url: str, save_path: str, header: str, out: Optional[str] = None):
        async with self._lock:
            if self.download:
                await asyncio.to_thread(self.aria2.resume, [self.download])
            else:
                downloads = await asyncio.to_thread(
                    self.aria2.add,
                    url,
                    options={"header": header, "dir": save_path, "out": out}
                )
                self.download = downloads[0] if downloads else None

    async def pause_download(self):
        async with self._lock:
            if self.download:
                await asyncio.to_thread(self.aria2.pause, [self.download])

    async def cancel_download(self):
        async with self._lock:
            if self.download:
                await asyncio.to_thread(self.aria2.remove, [self.download])
                self.download = None

    async def get_download_status(self):
        if self.download is None:
            return None

        try:
            download = await asyncio.to_thread(self.aria2.get_download, self.download.gid)
            
            total_length = download.total_length or 0
            completed_length = download.completed_length or 0
            
            return {
                'folderName': download.name or '',
                'fileSize': total_length,
                'progress': completed_length / total_length if total_length > 0 else 0.0,
                'downloadSpeed': download.download_speed or 0,
                'numPeers': 0,
                'numSeeds': 0,
                'status': download.status or 'unknown',
                'bytesDownloaded': completed_length,
            }
        except Exception:
            return None
