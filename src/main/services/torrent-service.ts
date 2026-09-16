import { NativeAddon } from "./native-addon";
import { TorrentClient } from "./torrent-client";

export const TorrentService = new TorrentClient({
  initialize: (port) => NativeAddon.torrentInitialize(port),
  request: (method, params) => NativeAddon.torrentRequest(method, params),
  shutdown: () => NativeAddon.torrentShutdown(),
});
