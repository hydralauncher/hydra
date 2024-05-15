import WebTorrentHealth from "webtorrent-health";

type WebTorrentHealthData = {
  seeds: number;
  peers: number;
};

export const webTorrentData = {
  async getSeedersAndPeers(magnet: string, retry = 0, timeout = 1500) {
    return new Promise((resolve, reject) => {
      WebTorrentHealth(
        magnet,
        { timeout },
        (err: Error, data: WebTorrentHealthData) => {
          if (err) {
            return reject(err);
          }

          const { peers, seeds } = data;

          if ((!peers || !seeds) && retry < 3) {
            return resolve(
              webTorrentData.getSeedersAndPeers(magnet, retry + 1, timeout * 2)
            );
          }

          return resolve({ peers, seeders: seeds });
        }
      );
    });
  },
};
