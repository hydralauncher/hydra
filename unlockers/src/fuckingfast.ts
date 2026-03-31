const FUCKINGFAST_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";
const FUCKINGFAST_DOMAINS = ["fuckingfast.co"];
const FUCKINGFAST_REGEX =
  /window\.open\("(https:\/\/fuckingfast\.co\/dl\/[^"]*)"\)/;

/** @param {unknown} url */
function isFuckingFastDomain(url) {
  const lowerUrl = String(url || "").toLowerCase();
  return FUCKINGFAST_DOMAINS.some((domain) => lowerUrl.includes(domain));
}

module.exports = {
  id: "fuckingfast",
  downloader: "FuckingFast",

  /**
   * @param {{ url?: unknown }} input
   * @param {{
   *   getText: (url: string, options?: { headers?: Record<string, string>; followRedirects?: boolean }) => Promise<{ text: string }>;
   * }} api
   */
  async unlock(input, api) {
    const sourceUrl = String(input?.url || "").trim();
    if (!sourceUrl) {
      throw new Error("Missing source URL");
    }

    if (!isFuckingFastDomain(sourceUrl)) {
      throw new Error(
        `Unsupported domain. Supported domains: ${FUCKINGFAST_DOMAINS.join(", ")}`
      );
    }

    const response = await api.getText(sourceUrl, {
      headers: { "User-Agent": FUCKINGFAST_USER_AGENT },
    });

    const html = response.text;
    if (typeof html !== "string") {
      throw new Error("Invalid hoster response");
    }

    const lowered = html.toLowerCase();
    if (lowered.includes("rate limit")) {
      throw new Error(
        "Rate limit exceeded. Please wait a few minutes and try again."
      );
    }

    if (html.includes("File Not Found Or Deleted")) {
      throw new Error("File not found or deleted");
    }

    const match = FUCKINGFAST_REGEX.exec(html);
    if (!match || !match[1]) {
      throw new Error("Could not extract download link from page");
    }

    return match[1];
  },
};
