module.exports = {
  id: "rootz",
  downloader: "Rootz",

  /**
   * @param {{ url?: unknown }} input
   * @param {{
   *   getJson: (url: string, options?: { headers?: Record<string, string>; followRedirects?: boolean }) => Promise<{
   *     ok: boolean;
   *     json?: { error?: string; data?: { url?: string } };
   *   }>;
   * }} api
   */
  async unlock(input, api) {
    const sourceUrl = String(input?.url ?? "").trim();
    if (!sourceUrl) {
      throw new Error("Missing source URL");
    }

    const parsed = new URL(sourceUrl);
    const pathSegments = parsed.pathname.split("/").filter(Boolean);

    if (pathSegments.length < 2 || pathSegments[0] !== "d") {
      throw new Error("Invalid rootz URL format");
    }

    const id = pathSegments[1];
    const apiUrl = `https://www.rootz.so/api/files/download-by-short/${id}`;
    const response = await api.getJson(apiUrl);

    if (!response.ok) {
      const errorMessage = response?.json?.error || "File not found";
      throw new Error(errorMessage);
    }

    const unlockedUrl = response?.json?.data?.url;
    if (typeof unlockedUrl !== "string" || unlockedUrl.length === 0) {
      throw new Error("Failed to get download URL from rootz API");
    }

    return unlockedUrl;
  },
};
