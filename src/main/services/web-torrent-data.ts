import WebTorrentHealth from "webtorrent-health";

type WebTorrentHealthData = {
  seeds: number;
  peers: number;
};

export const webTorrentData = {
  async getSeedersAndPeers(magnet: string) {
    return new Promise((resolve, reject) => {
      WebTorrentHealth(magnet, (err: Error, data: WebTorrentHealthData) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  },
};
