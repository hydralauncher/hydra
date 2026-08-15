import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("macCompatibility", {
  getSystemInfo: () => ipcRenderer.invoke("getMacSystemInfo"),
  getWineVersions: () => ipcRenderer.invoke("getMacWineVersions"),
  getGameEnvironment: (shop: string, objectId: string) =>
    ipcRenderer.invoke("getMacGameEnvironment", shop, objectId),
  checkGame: (
    shop: string,
    objectId: string,
    title: string,
    isWindowsGame: boolean
  ) =>
    ipcRenderer.invoke(
      "checkMacGameCompatibility",
      shop,
      objectId,
      title,
      isWindowsGame
    ),
  createEnvironment: (shop: string, objectId: string) =>
    ipcRenderer.invoke("createMacGameEnvironment", shop, objectId),
  testEnvironment: (shop: string, objectId: string) =>
    ipcRenderer.invoke("testMacGameEnvironment", shop, objectId),
  repairEnvironment: (shop: string, objectId: string) =>
    ipcRenderer.invoke("repairMacGameEnvironment", shop, objectId),
  deleteEnvironment: (shop: string, objectId: string) =>
    ipcRenderer.invoke("deleteMacGameEnvironment", shop, objectId),
  fixEverything: (shop: string, objectId: string, isWindowsGame: boolean) =>
    ipcRenderer.invoke("fixMacGameEverything", shop, objectId, isWindowsGame),
});
