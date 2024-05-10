import { openWebTorrent } from "@main/services/open-web-torrent"
import { registerEvent } from "../register-event"

const getMagnetData = async (_event: Electron.IpcMainInvokeEvent, magnet: string) => {
   return openWebTorrent.getSeedersAndPeers(magnet)
}

registerEvent(getMagnetData, {
  name: 'getMagnetData'
})
