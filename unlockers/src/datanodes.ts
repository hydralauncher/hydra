const DATANODES_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

module.exports = {
  id: "datanodes",
  downloader: "Datanodes",

  /**
   * @param {{ url?: unknown }} input
   * @param {{
   *   postForm: (
   *     url: string,
   *     body?: Record<string, unknown>,
   *     options?: { headers?: Record<string, string>; followRedirects?: boolean }
   *   ) => Promise<{ text: string }>;
   * }} api
   */
  async unlock(input, api) {
    const sourceUrl = String(input?.url || "").trim();
    if (!sourceUrl) {
      throw new Error("Missing source URL");
    }

    const parsed = new URL(sourceUrl);
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const fileCode = pathSegments[0];

    if (!fileCode) {
      throw new Error("Invalid datanodes URL");
    }

    const response = await api.postForm(
      "https://datanodes.to/download",
      {
        op: "download2",
        id: fileCode,
        rand: "",
        referer: "https://datanodes.to/download",
        method_free: "Free Download >>",
        method_premium: "",
        __dl: "1",
        g_captch__a: "1",
      },
      {
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          priority: "u=1, i",
          "sec-ch-ua":
            '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          Referer: "https://datanodes.to/download",
          "User-Agent": DATANODES_USER_AGENT,
          Cookie: "lang=english",
        },
      }
    );

    let payload;
    try {
      payload = JSON.parse(response.text);
    } catch {
      throw new Error("Failed to parse datanodes response");
    }

    if (typeof payload?.url !== "string" || payload.url.length === 0) {
      throw new Error("Failed to get the download link");
    }

    return decodeURIComponent(payload.url);
  },
};
