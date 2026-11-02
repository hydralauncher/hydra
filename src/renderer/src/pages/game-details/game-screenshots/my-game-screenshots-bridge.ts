import type {
  MyGameScreenshotsApi,
  MyGameScreenshotsLocalBridge,
} from "@shared";

export const myGameScreenshotsApi: MyGameScreenshotsApi = {
  get: <T>(path: string) =>
    window.electron.hydraApi.get<T>(path, { needsAuth: true }),
  delete: <T>(path: string) =>
    window.electron.hydraApi.delete<T>(path, { needsAuth: true }),
};

export const myGameScreenshotsLocal: MyGameScreenshotsLocalBridge = {
  getLocalScreenshotsForGame: (shop, objectId) =>
    window.electron.getLocalScreenshotsForGame(shop, objectId),
  deleteLocalScreenshotsForGame: (shop, objectId) =>
    window.electron.deleteLocalScreenshotsForGame(shop, objectId),
  countLocalScreenshotFiles: (shop, objectId) =>
    window.electron.countLocalScreenshotFilesForGame(shop, objectId),
  getPublishedScreenshotIdsForGame: (shop, objectId) =>
    window.electron.getPublishedScreenshotIdsForGame(shop, objectId),
  forgetPublishedScreenshots: (screenshotIds) =>
    window.electron.forgetPublishedScreenshots(screenshotIds),
  onLocalScreenshotsChange: (callback) =>
    window.electron.onLocalScreenshotsChange(callback),
};
