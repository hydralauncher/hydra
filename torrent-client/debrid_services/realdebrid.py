import requests

class RealDebrid:
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = "https://api.real-debrid.com/rest/1.0/"

    def get_user_info(self):
        url = self.base_url + "user"
        headers = {
            "Authorization": "Bearer " + self.api_key
        }
        response = requests.get(url, headers=headers)
        return response.json()

    def add_magnet_link(self, magnet):
        url = self.base_url + "torrents/addMagnet"
        headers = {
            "Authorization": "Bearer " + self.api_key
        }
        data = {
            "magnet": magnet
        }
        response = requests.post(url, headers=headers, data=data)
        return response.json()

    def select_all_files(self, torrent_id):
        url = self.base_url + "torrents/selectFiles/" + torrent_id
        headers = {
            "Authorization": "Bearer " + self.api_key
        }
        data = {
            "files": "all"
        }
        response = requests.post(url, headers=headers, data=data)
        return response

    def get_torrent_info(self, torrent_id):
        url = self.base_url + "torrents/info/" + torrent_id
        headers = {
            "Authorization": "Bearer " + self.api_key
        }
        response = requests.get(url, headers=headers)
        return response.json()

    def get_direct_link(self, link):
        url = self.base_url + "unrestrict/link"
        headers = {
            "Authorization": "Bearer " + self.api_key
        }
        data = {
            "link": link
        }
        response = requests.post(url, headers=headers, data=data)
        return response.json()
