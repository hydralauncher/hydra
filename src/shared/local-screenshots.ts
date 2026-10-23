export const toLocalScreenshotUrl = (path: string) =>
  `local:${path.replaceAll("\\", "/")}`;
