import { ipcMain } from "electron";
import { ProtonService } from "@main/services/proton";

ipcMain.handle("discoverProtonRunners", async () => {
  return ProtonService.discoverRunners();
});
