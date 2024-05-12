import axios, { AxiosResponse } from "axios";
import { Agent } from "https";

type OpenWebTorrentResponse =
  | {
      seeds: number;
      peers: number;
    }
  | {
      error: {
        code: number;
        message: string;
      };
    };

const httpsAgent = new Agent({
  rejectUnauthorized: false,
});
const axiosRef = axios.create({
  baseURL: "https://checker.openwebtorrent.com",
  httpsAgent,
});

export const openWebTorrent = {
  transformResponseError(response: AxiosResponse<OpenWebTorrentResponse>) {
    if ("error" in response.data) {
      throw new Error(response.data.error.message);
    }

    return response.data;
  },
  async getSeedersAndPeers(magnet: string) {
    const endpoint = "/check";
    const params = new URLSearchParams();
    params.append("magnet", magnet);

    const response = await axiosRef.get(endpoint, { params });
    const { seeds, peers } = this.transformResponseError(response);

    return {
      seeders: seeds,
      peers: peers,
    };
  },
};
