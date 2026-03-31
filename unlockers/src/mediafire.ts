const VALID_MEDIAFIRE_IDENTIFIER = /^[a-zA-Z0-9]+$/m;
const VALID_MEDIAFIRE_PRE_DL =
  /(?<=['"])(https?:)?(\/\/)?(www\.)?mediafire\.com\/(file|view|download)\/[^'"?]+\?dkey=[^'"]+(?=['"])/;
const VALID_DYNAMIC_DL =
  /(?<=['"])https?:\/\/download\d+\.mediafire\.com\/[^'"]+(?=['"])/;
const CHECK_HTTP = /^https?:\/\//m;

/** @param {unknown} url */
function processUrl(url) {
  let processed = String(url || "").replace("http://", "https://");

  if (VALID_MEDIAFIRE_IDENTIFIER.test(processed)) {
    processed = `https://mediafire.com/?${processed}`;
  }

  if (!CHECK_HTTP.test(processed)) {
    processed = processed.startsWith("//")
      ? `https:${processed}`
      : `https://${processed}`;
  }

  return processed;
}

/** @param {string} html */
function extractDirectUrl(html) {
  const preMatch = VALID_MEDIAFIRE_PRE_DL.exec(html);
  if (preMatch?.[0]) {
    const maybeUrl = preMatch[0];
    return maybeUrl.startsWith("//") ? `https:${maybeUrl}` : maybeUrl;
  }

  const dlMatch = VALID_DYNAMIC_DL.exec(html);
  if (dlMatch?.[0]) {
    return dlMatch[0];
  }

  throw new Error("No valid download links found");
}

module.exports = {
  id: "mediafire",
  downloader: "Mediafire",

  /**
   * @param {{ url?: unknown }} input
   * @param {{
   *   getText: (url: string, options?: { headers?: Record<string, string>; followRedirects?: boolean }) => Promise<{ ok: boolean; text: string }>;
   * }} api
   */
  async unlock(input, api) {
    const sourceUrl = processUrl(input?.url);
    const response = await api.getText(sourceUrl);

    if (!response.ok) {
      throw new Error("Failed to fetch Mediafire page");
    }

    return extractDirectUrl(response.text);
  },
};
