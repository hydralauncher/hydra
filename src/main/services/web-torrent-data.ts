import webTorrentHealth from "webtorrent-health";

type WebTorrentHealthData = {
  seeds: number;
  peers: number;
};

const MILLISECONDS = 1000;
const SECONDS = 1.5;

export const webTorrentData = {
  async getSeedersAndPeers(
    magnet: string
  ): Promise<{ seeders: number; peers: number } | null> {
    let peers = 0;
    let seeds = 0;
    let retry = 0;
    let timeout = SECONDS * MILLISECONDS;

    while (retry < 3) {
      try {
        const data: WebTorrentHealthData = await webTorrentHealth(magnet, {
          timeout,
        });

        peers = data.peers;
        seeds = data.seeds;

        if (peers || seeds) break;
      } catch (e) {
        if (retry === 2) {
          return Promise.reject(
            new Error("Failed to get seeders and peers after 3 retries.")
          );
        }
      }

      timeout *= 2;
      retry++;
    }

    return { peers, seeders: seeds };
  },
};
