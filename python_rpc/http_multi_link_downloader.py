import asyncio
from typing import Optional, List, Dict, Any
import aria2p
from aria2p.client import ClientException as DownloadNotFound


class HttpMultiLinkDownloader:
    def __init__(self):
        self.downloads: List[aria2p.Download] = []
        self.completed_downloads: List[Dict[str, Any]] = []
        self.total_size: Optional[int] = None
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

    async def start_download(self, urls: List[str], save_path: str, header: Optional[str] = None, 
                            out: Optional[str] = None, total_size: Optional[int] = None):
        async with self._lock:
            options = {"dir": save_path}
            if header:
                options["header"] = header
            if out:
                options["out"] = out

            await self.cancel_download()
            self.completed_downloads.clear()
            self.total_size = total_size

            tasks = [self._add_download(url, options) for url in urls]
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _add_download(self, url: str, options: Dict[str, Any]):
        try:
            added_downloads = await asyncio.to_thread(self.aria2.add, url, options=options)
            async with self._lock:
                self.downloads.extend(added_downloads)
        except Exception:
            pass

    async def pause_download(self):
        async with self._lock:
            if self.downloads:
                try:
                    await asyncio.to_thread(self.aria2.pause, self.downloads)
                except Exception:
                    pass

    async def cancel_download(self):
        async with self._lock:
            if self.downloads:
                try:
                    await asyncio.to_thread(self.aria2.remove, self.downloads)
                except Exception:
                    pass
                finally:
                    self.downloads.clear()
                    self.completed_downloads.clear()

    async def get_download_status(self):
        if not self.downloads and not self.completed_downloads:
            return []

        async with self._lock:
            downloads_copy = list(self.downloads)
            completed_downloads_copy = list(self.completed_downloads)
            total_size = self.total_size

        total_completed = sum(d['size'] for d in completed_downloads_copy)
        current_download_speed = 0
        active_downloads: List[Dict[str, Any]] = []
        to_remove: List[aria2p.Download] = []
        new_completed: List[Dict[str, Any]] = []

        tasks = [self._get_single_download_status(download) for download in downloads_copy]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for download, result in zip(downloads_copy, results):
            if result is None:
                to_remove.append(download)
            elif isinstance(result, dict):
                if result.get('complete', False):
                    new_completed.append(result)
                    to_remove.append(download)
                    total_completed += result.get('completed', 0)
                else:
                    active_downloads.append({
                        'name': result.get('name', ''),
                        'size': result.get('size', 0),
                        'completed': result.get('completed', 0),
                        'speed': result.get('speed', 0)
                    })
                    total_completed += result.get('completed', 0)
                    current_download_speed += result.get('speed', 0)

        async with self._lock:
            for download in to_remove:
                try:
                    self.downloads.remove(download)
                except ValueError:
                    pass
            
            self.completed_downloads.extend(new_completed)

            if not (self.total_size or active_downloads or self.completed_downloads):
                return []

            folder_name = None
            if active_downloads:
                folder_name = active_downloads[0]['name']
            elif self.completed_downloads:
                folder_name = self.completed_downloads[0]['name']

            if folder_name and '/' in folder_name:
                folder_name = folder_name.split('/')[0]

            if not total_size:
                total_size = (sum(d['size'] for d in active_downloads) + 
                            sum(d['size'] for d in self.completed_downloads))

            is_complete = (len(active_downloads) == 0 and 
                          total_size > 0 and 
                          total_completed >= (total_size * 0.99))

            if is_complete:
                self.completed_downloads.clear()

            return [{
                'folderName': folder_name or '',
                'fileSize': total_size or 0,
                'progress': total_completed / total_size if total_size > 0 else 0.0,
                'downloadSpeed': current_download_speed,
                'numPeers': 0,
                'numSeeds': 0,
                'status': 'complete' if is_complete else 'active',
                'bytesDownloaded': total_completed,
            }]

    async def _get_single_download_status(self, download: aria2p.Download) -> Optional[Dict[str, Any]]:
        try:
            current_download = await asyncio.to_thread(self.aria2.get_download, download.gid)

            if not current_download or not current_download.files:
                return None

            completed = current_download.completed_length or 0
            speed = current_download.download_speed or 0
            total_length = current_download.total_length or 0

            if current_download.status == 'complete':
                return {
                    'complete': True,
                    'name': current_download.name or '',
                    'size': total_length,
                    'completed': total_length,
                    'speed': 0
                }
            else:
                return {
                    'complete': False,
                    'name': current_download.name or '',
                    'size': total_length,
                    'completed': completed,
                    'speed': speed
                }

        except DownloadNotFound:
            return None
        except Exception:
            return None