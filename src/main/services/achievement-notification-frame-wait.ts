const FRAME_SCRIPT =
  "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))))";

export interface AchievementNotificationFrameSource {
  executeJavaScript(script: string): Promise<unknown>;
}

export async function waitForAchievementNotificationFrames(
  webContents: AchievementNotificationFrameSource,
  timeoutMs: number
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    await Promise.race([
      webContents.executeJavaScript(FRAME_SCRIPT),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("notification window did not show")),
          timeoutMs
        );
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
