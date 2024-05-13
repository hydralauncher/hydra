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
          return reject(err);
        }

        const { peers, seeds } = data;

        return resolve({ peers, seeders: seeds });
      });
    });
  },
};
