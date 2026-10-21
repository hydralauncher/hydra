import { ipcRenderer } from "electron";
import type {
  GameShop,
  ScreenshotInputStatus,
  ScreenshotsDevApi,
  ScreenshotsDevBurstRequest,
  ScreenshotsDevCaptureRequest,
  ScreenshotsDevFeedbackKind,
  ScreenshotsDevGame,
  ScreenshotsDevInputResult,
  ScreenshotsDevModerationOutcome,
  ScreenshotsDevResult,
  ScreenshotsDevUploadFailure,
} from "@types";

export const screenshotsDevApi: ScreenshotsDevApi = {
  listGames: (): Promise<ScreenshotsDevGame[]> =>
    ipcRenderer.invoke("screenshotsDevListGames"),
  capture: (
    request: ScreenshotsDevCaptureRequest
  ): Promise<ScreenshotsDevResult> =>
    ipcRenderer.invoke("screenshotsDevCapture", request),
  burst: (request: ScreenshotsDevBurstRequest): Promise<ScreenshotsDevResult> =>
    ipcRenderer.invoke("screenshotsDevBurst", request),
  closeGame: (
    shop: GameShop,
    objectId: string
  ): Promise<ScreenshotsDevResult> =>
    ipcRenderer.invoke("screenshotsDevCloseGame", shop, objectId),
  feedback: (kind: ScreenshotsDevFeedbackKind): Promise<ScreenshotsDevResult> =>
    ipcRenderer.invoke("screenshotsDevFeedback", kind),
  moderation: (
    clientId: string,
    outcome: ScreenshotsDevModerationOutcome,
    reason: string | null
  ): Promise<ScreenshotsDevResult> =>
    ipcRenderer.invoke("screenshotsDevModeration", clientId, outcome, reason),
  uploadFailure: (
    clientId: string,
    failure: ScreenshotsDevUploadFailure
  ): Promise<ScreenshotsDevResult> =>
    ipcRenderer.invoke("screenshotsDevUploadFailure", clientId, failure),
  triggerInput: (): Promise<ScreenshotsDevInputResult> =>
    ipcRenderer.invoke("screenshotsDevTriggerInput"),
  inputStatus: (): Promise<ScreenshotInputStatus> =>
    ipcRenderer.invoke("screenshotsDevInputStatus"),
  bigPictureReview: (clientIds: string[]): Promise<ScreenshotsDevResult> =>
    ipcRenderer.invoke("screenshotsDevBigPicture", clientIds),
  deleteCaptures: (): Promise<ScreenshotsDevResult> =>
    ipcRenderer.invoke("screenshotsDevDeleteCaptures"),
};
