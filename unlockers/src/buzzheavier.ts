const BUZZHEAVIER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";
const BUZZHEAVIER_DOMAINS = ["buzzheavier.com", "bzzhr.co", "fuckingfast.net"];

/** @param {unknown} url */
function isBuzzheavierDomain(url) {
  const lowerUrl = String(url || "").toLowerCase();
  return BUZZHEAVIER_DOMAINS.some((domain) => lowerUrl.includes(domain));
}

module.exports = {
  id: "buzzheavier",
  downloader: "Buzzheavier",

  /**
   * @param {{ url?: unknown }} input
   * @param {{
   *   getText: (url: string, options?: { headers?: Record<string, string>; followRedirects?: boolean }) => Promise<{ ok: boolean }>;
   *   head: (url: string, options?: { headers?: Record<string, string>; followRedirects?: boolean }) => Promise<{ headers?: Record<string, string> }>;
   * }} api
   */
  async unlock(input, api) {
    const sourceUrl = String(input?.url || "").trim();
    if (!sourceUrl) {
      throw new Error("Missing source URL");
    }

    if (!isBuzzheavierDomain(sourceUrl)) {
      throw new Error(
        `Unsupported domain. Supported domains: ${BUZZHEAVIER_DOMAINS.join(", ")}`
      );
    }

    const baseUrl = sourceUrl.split("#")[0];

    await api.getText(baseUrl, {
      headers: { "User-Agent": BUZZHEAVIER_USER_AGENT },
    });

    const downloadProbe = await api.head(`${baseUrl}/download`, {
      followRedirects: false,
      headers: {
        "hx-current-url": baseUrl,
        "hx-request": "true",
        referer: baseUrl,
        "User-Agent": BUZZHEAVIER_USER_AGENT,
      },
    });

    const hxRedirect =
      downloadProbe?.headers?.["hx-redirect"] ||
      downloadProbe?.headers?.["Hx-Redirect"];

    if (typeof hxRedirect !== "string" || hxRedirect.length === 0) {
      throw new Error(
        "Could not extract download link. File may be deleted or is a directory."
      );
    }

    const domain = new URL(baseUrl).hostname;
    if (hxRedirect.startsWith("/dl/")) {
      return `https://${domain}${hxRedirect}`;
    }

    return hxRedirect;
  },
};
