import os
import time
from urllib.parse import unquote
from debrid_services.realdebrid import RealDebrid
from pySmartDL import SmartDL
import threading

class DebridDownloader:
    smartdl_handler = None
    save_path = ''

    # Debrid service is busy when it is working on caching the torrent, this means that we still don't have the direct link yet
    is_debrid_busy = False
    debrid_caching_progress = 0
    debrid_caching_failed = False
    debrid_caching_cancelled = False

    def set_api_key(self, api_key):
        self.api_key = api_key
        
    def start_download(self, magnet, save_path):     
        self.save_path = save_path

        # Generate direct link from magnet link
        self.debrid_caching_cancelled = False
        self.is_debrid_busy = True
        self.__generate_direct_link(magnet, self.__handle_caching_result)

    def pause_download(self):
        self.debrid_caching_cancelled = True
        if (self.smartdl_handler):
            self.smartdl_handler.pause()

    def cancel_download(self):
        self.debrid_caching_cancelled = True
        if (self.smartdl_handler):
            self.smartdl_handler.stop()

    def get_status(self, downloading_game_id):
        status = self.__get_generic_state('debrid_busy' if self.is_debrid_busy else self.smartdl_handler.get_status())
        progress = self.__get_generic_progress(status, 0 if self.is_debrid_busy else self.smartdl_handler.get_progress())
        return {
            'folderName': '-' if self.is_debrid_busy else os.path.splitext(os.path.basename(self.smartdl_handler.get_dest()))[0],
            'fileSize': 0 if self.is_debrid_busy else self.smartdl_handler.get_final_filesize(),
            'gameId': downloading_game_id,
            'progress': progress,
            'downloadSpeed': 0 if self.is_debrid_busy else self.smartdl_handler.get_speed(),
            'timeRemaining': 0 if self.is_debrid_busy else (self.smartdl_handler.get_eta() * 1000),
            'numPeers': '-',
            'numSeeds': '-',
            'status': status,
            'bytesDownloaded': 0 if self.is_debrid_busy else self.smartdl_handler.get_dl_size(),
            'debridCachingProgress': self.debrid_caching_progress if self.is_debrid_busy else 100,
        }
    
    def is_debrid_caching_failed(self):
        return self.debrid_caching_failed
    
    # Private methods
    def __handle_caching_result(self, result):
        direct_link = unquote(result)

        if self.debrid_caching_failed or result == '':
            return

        # Format the destination path
        filename = os.path.basename(direct_link)
        filename_without_ext = os.path.splitext(filename)[0]
        dest = os.path.join(self.save_path, filename_without_ext)
        dest = os.path.join(dest, "")

        self.smartdl_handler = SmartDL(direct_link, dest, verify=False, progress_bar=False, threads=1)
        self.smartdl_handler.start(blocking=False)
        self.is_debrid_busy = False

    def __generate_direct_link(self, magnet, callback):
        # Reset debrid caching status
        self.debrid_caching_failed = False

        realdebrid = RealDebrid(self.api_key)
        user_information = realdebrid.get_user_info()

        # Check if the user information is valid, if not, set debrid caching status to failed
        if 'error' in user_information:
            self.debrid_caching_failed = True
            return ''

        torrent_id = realdebrid.add_magnet_link(magnet)['id']

        # By default, select all files in the torrent
        realdebrid.select_all_files(torrent_id)

        # Start the while loop in a separate thread
        threading.Thread(target=self.__fetch_torrent_info, args=(realdebrid, torrent_id, callback)).start()
    
    def __fetch_torrent_info(self, realdebrid, torrent_id, callback):
        torrent_info = realdebrid.get_torrent_info(torrent_id)
        while not self.debrid_caching_cancelled and (torrent_info['status'] != 'downloaded' or torrent_info['progress'] != 100):
            self.debrid_caching_progress = torrent_info['progress']
            if torrent_info['status'] in ['magnet_error', 'error', 'virus', 'dead']:
                self.debrid_caching_failed = True
                callback('')
                return
            time.sleep(1)
            torrent_info = realdebrid.get_torrent_info(torrent_id)
        
        if self.debrid_caching_cancelled:
            callback('')
            return
        
        torrent_link = torrent_info['links'][0]
        callback(realdebrid.get_direct_link(torrent_link)['download'])

    # Get progress based on download status, taking into consideration debrid caching status and failures
    def __get_generic_progress(self, status, download_progress):
        if status == 5 or status == 0:
            return 1
        elif status == 6:
            return 0
        else:
            return download_progress

    # This method converts pySmartDL states to generic states used in the frontend
    def __get_generic_state(self, state):
        if state == 'downloading' or state == 'ready':
            return 3
        elif state == 'finished' or self.is_debrid_caching_failed():
            return 5
        elif state == 'debrid_busy':
            return 6
        else:
            return 0
