const BYPASS_BASE_URL = "https://cdn.pixeldrain.eu.cc";

/** @param {string} rawUrl */
function extractId(rawUrl) {
  const parsed = new URL(rawUrl);
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const id = pathParts[1];

  if (pathParts[0] !== "u" || !id) {
    throw new Error(`Invalid pixeldrain URL: ${rawUrl}`);
  }

  return id;
}

module.exports = {
  id: "pixeldrain",
  downloader: "PixelDrain",

  /**
   * @param {{ url?: unknown }} input
   * @param {{
   *   head: (url: string, options?: { headers?: Record<string, string>; followRedirects?: boolean }) => Promise<{ status: number }>;
   * }} api
   */
  async unlock(input, api) {
    const sourceUrl = String(input?.url || "").trim();
    if (!sourceUrl) {
      throw new Error("Missing source URL");
    }

    const id = extractId(sourceUrl);
    const bypassUrl = `${BYPASS_BASE_URL}/${id}`;

    try {
      const bypassHead = await api.head(bypassUrl);
      if (bypassHead.status >= 200 && bypassHead.status < 400) {
        return bypassUrl;
      }
    } catch {
      // Ignore bypass errors and continue to fallback URL.
    }

    const availability = await api.head(`https://pixeldrain.com/u/${id}`);
    if (availability.status === 404) {
      throw new Error("File not found");
    }

    return `https://pixeldrain.com/api/file/${id}?download`;
  },
};
