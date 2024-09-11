import qbittorrentapi
import ast

class api:

    def __del__(self):
        try:
            self.client.auth_log_out()
        except qbittorrentapi.exceptions.Forbidden403Error:
            print("logged out of qbitt")

    def __init__(self):
        self.torrent_hashes = {}
        self.downloading_game_id = -1
        self.connection_info = dict(
            host="192.168.1.234",
            port=8000,
            username="mason",
            password="Hippowdon19",
        )
        

        qbt_client = qbittorrentapi.Client(**self.connection_info)
        try:
            qbt_client.auth_log_in()
        except qbittorrentapi.LoginFailed as e:
            raise e
        self.client = qbt_client
        print("logged into qbitt")

    def __str__(self):
        return f"hashes:{self.torrent_hashes}\ngame_id: {self.downloading_game_id}\nclient: {self.client}"

    def start_download(self, game_id: int, magnet: str = "None", save_path: str = None):
        save_path = None
        params = None
        if save_path is None:
            params = {'urls': magnet}
        else:
            params = {'urls': magnet, 'save_path': save_path}     

        if self.client.torrents.add(**params) != "Ok.":
            for torrent in self.client.torrents_info():
                if torrent.infohash_v1.lower() in magnet.lower():
                    self.downloading_game_id = game_id
                    self.torrent_hashes[game_id] = torrent.hash
                    return
            print(params)
            raise Exception("Failed to add torrent.")

        for torrent in self.client.torrents_info():
            if torrent.infohash_v1.lower() in magnet.lower():
                self.downloading_game_id = game_id
                self.torrent_hashes[game_id] = torrent.hash
                return

        raise Exception("Cannot find Torrent after Adding it")

    def pause_download(self, game_id: int):
        torrent_hash = self.torrent_hashes[game_id]
        if torrent_hash is None:
            self.client.torrents.pause(game_id)
        else:
            self.client.torrents.pause(torrent_hash)
        self.downloading_game_id = -1
        
    def cancel_download(self, game_id: int):
        torrent_hash = self.torrent_hashes.get(game_id)
        if torrent_hash is None:
            self.client.torrents.delete(delete_files=True, torrent_hashes=game_id)
        else:
            self.client.torrents.delete(delete_files=True, torrent_hashes=torrent_hash)
        self.torrent_hashes[game_id] = None
        self.downloading_game_id = -1

    def abort_session(self, hashes = []):
        if hashes is []:
            for game_id in self.torrent_hashes:
                torrent_hash = self.torrent_hashes[game_id]
                self.cancel_download(torrent_hash)
        else:
            
            for i in ast.literal_eval(hashes):
                self.cancel_download(i)
            
        self.torrent_hashes = {}
        self.downloading_game_id = -1

    def get_download_status(self, game_id: int = -1):
        torrent_final = None
        if game_id != -1:
            for torrent in self.client.torrents_info():
                if torrent.hash == game_id:
                    torrent_final = torrent
                    break
                raise Exception("Hash not found")
        elif self.downloading_game_id == -1:
            return None
        else:
            torrent_hash = self.torrent_hashes[self.downloading_game_id]
            for torrent in self.client.torrents_info():
                if torrent.hash == torrent_hash:
                    torrent_final = torrent
                    break
                raise Exception("Hash not found")
            
        return {
            'folderName': torrent_final.name if torrent_final.name else "",
            'fileSize': torrent_final.total_size if torrent_final.total_size else 0,
            'gameId': self.downloading_game_id,
            'progress': torrent_final.progress,
            'downloadSpeed': torrent_final.dlspeed,
            'numPeers': torrent_final.num_leechs,
            'numSeeds': torrent_final.num_seeds,
            'status': torrent_final.state,
            'bytesDownloaded': torrent_final.progress * torrent_final.total_size,
        }
