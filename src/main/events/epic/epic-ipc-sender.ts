import { fileURLToPath } from "node:url";

export function isTrustedEpicSender(
  sender: { id: number; isMainFrame: boolean; url: string },
  mainWindowId: number | null,
  rendererUrls: string[]
) {
  if (
    mainWindowId === null ||
    sender.id !== mainWindowId ||
    !sender.isMainFrame
  ) {
    return false;
  }
  try {
    const actual = new URL(sender.url);
    if (actual.username || actual.password) return false;
    actual.hash = "";
    return rendererUrls.some((rendererUrl) => {
      const expected = new URL(rendererUrl);
      expected.hash = "";
      if (expected.href === actual.href) return true;
      // Chromium leaves '~' literal in file URLs while Node encodes it as '%7E'.
      // Compare the same decoded local file without relaxing remote URL checks.
      return (
        expected.protocol === "file:" &&
        actual.protocol === "file:" &&
        expected.host === actual.host &&
        expected.search === actual.search &&
        fileURLToPath(expected) === fileURLToPath(actual)
      );
    });
  } catch {
    return false;
  }
}
