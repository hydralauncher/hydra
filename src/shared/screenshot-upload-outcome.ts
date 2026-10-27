import type { LocalScreenshot } from "@types";

const isActiveUpload = (screenshot: LocalScreenshot) =>
  screenshot.state === "queued" || screenshot.state === "uploading";

const isAwaitingModeration = (screenshot: LocalScreenshot) =>
  screenshot.state === "uploaded" &&
  (screenshot.moderationStatus === null ||
    screenshot.moderationStatus === "PENDING");

const isUploadProblem = (screenshot: LocalScreenshot) =>
  screenshot.state === "failed" ||
  (screenshot.state === "uploaded" &&
    screenshot.moderationStatus === "BLOCKED");

export const createScreenshotUploadOutcomeTracker = () => {
  const activeIds = new Set<string>();

  return (screenshots: LocalScreenshot[]) => {
    const problems: LocalScreenshot[] = [];
    for (const screenshot of screenshots) {
      if (isActiveUpload(screenshot)) {
        activeIds.add(screenshot.clientId);
        continue;
      }
      if (isAwaitingModeration(screenshot)) continue;
      if (
        activeIds.delete(screenshot.clientId) &&
        isUploadProblem(screenshot)
      ) {
        problems.push(screenshot);
      }
    }
    return problems;
  };
};
