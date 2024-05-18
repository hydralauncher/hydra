import { webTorrentData } from "@main/services/web-torrent-data";
import { registerEvent } from "../../register-event";

const getMagnetHealth = async (
  _event: Electron.IpcMainInvokeEvent,
  magnet: string
) => {
  return webTorrentData.getSeedersAndPeers(magnet);
};

registerEvent("getMagnetHealth", getMagnetHealth);
