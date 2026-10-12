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
      return expected.href === actual.href;
    });
  } catch {
    return false;
  }
}
