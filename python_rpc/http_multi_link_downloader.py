import aria2p
from aria2p.client import ClientException as DownloadNotFound

class HttpMultiLinkDownloader:
    def __init__(self):
        self.downloads = []
        self.completed_downloads = []
        self.total_size = None
        self.aria2 = aria2p.API(
            aria2p.Client(
                host="http://localhost",
                port=6800,
                secret=""
            )
        )

    def start_download(self, urls: list[str], save_path: str, header: str = None, out: str = None, total_size: int = None):
        """Add multiple URLs to download queue with same options"""
        options = {"dir": save_path}
        if header:
            options["header"] = header
        if out:
            options["out"] = out
            
        # Clear any existing downloads first
        self.cancel_download()
        self.completed_downloads = []
        self.total_size = total_size
            
        for url in urls:
            try:
                added_downloads = self.aria2.add(url, options=options)
                self.downloads.extend(added_downloads)
            except Exception as e:
                print(f"Error adding download for URL {url}: {str(e)}")

    def pause_download(self):
        """Pause all active downloads"""
        if self.downloads:
            try:
                self.aria2.pause(self.downloads)
            except Exception as e:
                print(f"Error pausing downloads: {str(e)}")

    def cancel_download(self):
        """Cancel and remove all downloads"""
        if self.downloads:
            try:
                # First try to stop the downloads
                self.aria2.remove(self.downloads)
            except Exception as e:
                print(f"Error removing downloads: {str(e)}")
            finally:
                # Clear the downloads list regardless of success/failure
                self.downloads = []
                self.completed_downloads = []

    def get_download_status(self):
        """Get status for all tracked downloads, auto-remove completed/failed ones"""
        if not self.downloads and not self.completed_downloads:
            return []
            
        total_completed = 0
        current_download_speed = 0
        active_downloads = []
        to_remove = []
        
        # First calculate sizes from completed downloads
        for completed in self.completed_downloads:
            total_completed += completed['size']
            
        # Then check active downloads
        for download in self.downloads:
            try:
                current_download = self.aria2.get_download(download.gid)
                
                # Skip downloads that are not properly initialized
                if not current_download or not current_download.files:
                    to_remove.append(download)
                    continue
                
                # Add to completed size and speed calculations    
                total_completed += current_download.completed_length
                current_download_speed += current_download.download_speed
                    
                # If download is complete, move it to completed_downloads
                if current_download.status == 'complete':
                    self.completed_downloads.append({
                        'name': current_download.name,
                        'size': current_download.total_length
                    })
                    to_remove.append(download)
                else:
                    active_downloads.append({
                        'name': current_download.name,
                        'size': current_download.total_length,
                        'completed': current_download.completed_length,
                        'speed': current_download.download_speed
                    })
                    
            except DownloadNotFound:
                to_remove.append(download)
                continue
            except Exception as e:
                print(f"Error getting download status: {str(e)}")
                continue

        # Clean up completed/removed downloads from active list
        for download in to_remove:
            try:
                if download in self.downloads:
                    self.downloads.remove(download)
            except ValueError:
                pass

        # Return aggregate status
        if self.total_size or active_downloads or self.completed_downloads:
            # Use the first active download's name as the folder name, or completed if none active
            folder_name = None
            if active_downloads:
                folder_name = active_downloads[0]['name']
            elif self.completed_downloads:
                folder_name = self.completed_downloads[0]['name']
                
            if folder_name and '/' in folder_name:
                folder_name = folder_name.split('/')[0]

            # Use provided total size if available, otherwise sum from downloads
            total_size = self.total_size
            if not total_size:
                total_size = sum(d['size'] for d in active_downloads) + sum(d['size'] for d in self.completed_downloads)
                
            # Calculate completion status based on total downloaded vs total size
            is_complete = len(active_downloads) == 0 and total_completed >= (total_size * 0.99)  # Allow 1% margin for size differences
            
            # If all downloads are complete, clear the completed_downloads list to prevent status updates
            if is_complete:
                self.completed_downloads = []
            
            return [{
                'folderName': folder_name,
                'fileSize': total_size,
                'progress': total_completed / total_size if total_size > 0 else 0,
                'downloadSpeed': current_download_speed,
                'numPeers': 0,
                'numSeeds': 0,
                'status': 'complete' if is_complete else 'active',
                'bytesDownloaded': total_completed,
            }]

        return []