import webTorrentHealth from "webtorrent-health";

type WebTorrentHealthData = {
  seeds: number;
  peers: number;
};

export const webTorrentData = {
  async getSeedersAndPeers(
    magnet: string
  ): Promise<{ seeders: number; peers: number }> {
    let peers = 0;
    let seeds = 0;
    let retry = 0;

    while (retry < 3 && (!peers || !seeds)) {
      try {
        const data: WebTorrentHealthData = await webTorrentHealth(magnet, {
          timeout: 1500 * (retry + 1),
        });

        peers = data.peers;
        seeds = data.seeds;
      } catch (e) {
        retry++;
      }
    }

    return { peers, seeders: seeds };
  },
};
