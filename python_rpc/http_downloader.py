import aria2p
from typing import Union, List
import logging
import os
from pathlib import Path
from aria2p import API, Client, Download
import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class HttpDownloader:
    def __init__(self):
        self.downloads = []  # vom păstra toate download-urile active
        self.aria2 = API(Client(host="http://localhost", port=6800))
        self.download = None  # pentru compatibilitate cu codul vechi

    def unlock_alldebrid_link(self, link: str) -> str:
        """Deblochează un link AllDebrid și returnează link-ul real de descărcare."""
        api_key = os.getenv('ALLDEBRID_API_KEY')
        if not api_key:
            logger.error("AllDebrid API key nu a fost găsită în variabilele de mediu")
            return link

        try:
            response = requests.post(
                "https://api.alldebrid.com/v4/link/unlock",
                params={
                    "agent": "hydra",
                    "apikey": api_key,
                    "link": link
                }
            )
            data = response.json()
            
            if data.get("status") == "success":
                return data["data"]["link"]
            else:
                logger.error(f"Eroare la deblocarea link-ului AllDebrid: {data.get('error', {}).get('message', 'Unknown error')}")
                return link
        except Exception as e:
            logger.error(f"Eroare la apelul API AllDebrid: {str(e)}")
            return link

    def start_download(self, url: Union[str, List[str]], save_path: str, header: str = None, out: str = None):
        logger.info(f"Starting download with URL: {url}, save_path: {save_path}, header: {header}, out: {out}")
        
        # Pentru AllDebrid care returnează un link per fișier
        if isinstance(url, list):
            logger.info(f"Multiple URLs detected: {len(url)} files to download")
            self.downloads = []
            
            # Deblocăm toate link-urile AllDebrid
            unlocked_urls = []
            for single_url in url:
                logger.info(f"Unlocking AllDebrid URL: {single_url}")
                unlocked_url = self.unlock_alldebrid_link(single_url)
                if unlocked_url:
                    unlocked_urls.append(unlocked_url)
                    logger.info(f"URL deblocat cu succes: {unlocked_url}")
            
            # Descărcăm folosind link-urile deblocate
            for unlocked_url in unlocked_urls:
                logger.info(f"Adding download for unlocked URL: {unlocked_url}")
                options = {
                    "dir": save_path
                }
                if header:
                    if isinstance(header, list):
                        options["header"] = header
                    else:
                        options["header"] = [header]
                
                try:
                    download = self.aria2.add_uris([unlocked_url], options=options)
                    logger.info(f"Download added successfully: {download.gid}")
                    self.downloads.append(download)
                except Exception as e:
                    logger.error(f"Error adding download for URL {unlocked_url}: {str(e)}")
            
            if self.downloads:
                self.download = self.downloads[0]  # păstrăm primul pentru referință
            else:
                logger.error("No downloads were successfully added!")
                
        # Pentru RealDebrid/alte servicii care returnează un singur link pentru tot
        else:
            logger.info(f"Single URL download: {url}")
            options = {
                "dir": save_path
            }
            if header:
                if isinstance(header, list):
                    options["header"] = header
                else:
                    options["header"] = [header]
            if out:
                options["out"] = out
                
            try:
                download = self.aria2.add_uris([url], options=options)
                self.download = download
                self.downloads = [self.download]
                logger.info(f"Single download added successfully: {self.download.gid}")
            except Exception as e:
                logger.error(f"Error adding single download: {str(e)}")
    
    def pause_download(self):
        try:
            for download in self.downloads:
                download.pause()
        except Exception as e:
            logger.error(f"Error pausing downloads: {str(e)}")
    
    def cancel_download(self):
        try:
            for download in self.downloads:
                download.remove()
        except Exception as e:
            logger.error(f"Error canceling downloads: {str(e)}")

    def get_download_status(self):
        try:
            if not self.downloads:
                return None

            total_size = 0
            downloaded = 0
            download_speed = 0
            active_downloads = []

            for download in self.downloads:
                try:
                    download.update()
                    if download.is_active:
                        active_downloads.append(download)
                        total_size += download.total_length
                        downloaded += download.completed_length
                        download_speed += download.download_speed
                except Exception as e:
                    logger.error(f"Error updating download status for {download.gid}: {str(e)}")

            if not active_downloads:
                return None

            # Folosim primul download pentru numele folderului
            folder_path = os.path.dirname(active_downloads[0].files[0].path)
            folder_name = os.path.basename(folder_path)

            return {
                "progress": downloaded / total_size if total_size > 0 else 0,
                "numPeers": 0,  # nu este relevant pentru HTTP
                "numSeeds": 0,  # nu este relevant pentru HTTP
                "downloadSpeed": download_speed,
                "bytesDownloaded": downloaded,
                "fileSize": total_size,
                "folderName": folder_name,
                "status": "downloading"
            }
        except Exception as e:
            logger.error(f"Error getting download status: {str(e)}")
            return None
