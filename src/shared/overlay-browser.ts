export const OVERLAY_BROWSER_HOME_URL = "https://duckduckgo.com";
export const OVERLAY_BROWSER_CHROME_HEIGHT = 96;

export const isAllowedOverlayBrowserUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

export const normalizeOverlayBrowserUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  return isAllowedOverlayBrowserUrl(withScheme) ? withScheme : null;
};
