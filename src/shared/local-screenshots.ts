import type { LocalScreenshot } from "@types";

export const toLocalScreenshotUrl = (path: string) =>
  `local:${path.replaceAll("\\", "/")}`;

export const getAdjacentLocalScreenshot = (
  screenshots: LocalScreenshot[],
  clientId: string,
  direction: -1 | 1
) => {
  const index = screenshots.findIndex(
    (screenshot) => screenshot.clientId === clientId
  );
  if (index === -1) return null;

  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= screenshots.length) return null;
  return screenshots[nextIndex];
};

export const resolveViewerSelection = (
  screenshots: LocalScreenshot[],
  clientId: string | null,
  previousIndex: number
) => {
  if (!clientId || !screenshots.length) return null;

  const current = screenshots.find(
    (screenshot) => screenshot.clientId === clientId
  );
  if (current) return current;

  return screenshots[Math.min(previousIndex, screenshots.length - 1)] ?? null;
};
