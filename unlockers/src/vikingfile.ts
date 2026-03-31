module.exports = {
  id: "vikingfile",
  downloader: "VikingFile",

  /**
   * @param {{ url?: unknown; config?: { MAIN_VITE_NIMBUS_API_URL?: unknown } }} input
   * @param {{
   *   postJson: (
   *     url: string,
   *     body?: Record<string, unknown>,
   *     options?: { headers?: Record<string, string>; followRedirects?: boolean }
   *   ) => Promise<{ json?: { link?: string } }>;
   *   head: (url: string, options?: { headers?: Record<string, string>; followRedirects?: boolean }) => Promise<{
   *     headers?: Record<string, string>;
   *   }>;
   * }} api
   */
  async unlock(input, api) {
    const baseUrl = input?.config?.MAIN_VITE_NIMBUS_API_URL;
    if (typeof baseUrl !== "string" || baseUrl.length === 0) {
      throw new Error("Missing MAIN_VITE_NIMBUS_API_URL in unlocker config");
    }

    const sourceUrl = String(input?.url ?? "").trim();
    if (!sourceUrl) {
      throw new Error("Missing source URL");
    }

    const unlockResponse = await api.postJson(`${baseUrl}/hosters/unlock`, {
      url: sourceUrl,
    });

    const redirectUrl = unlockResponse?.json?.link;
    if (typeof redirectUrl !== "string" || redirectUrl.length === 0) {
      throw new Error("Failed to unlock VikingFile URL");
    }

    try {
      const headResponse = await api.head(redirectUrl, {
        followRedirects: false,
      });

      const location = headResponse?.headers?.location;
      if (typeof location === "string" && location.length > 0) {
        return location;
      }

      return redirectUrl;
    } catch {
      return redirectUrl;
    }
  },
};
