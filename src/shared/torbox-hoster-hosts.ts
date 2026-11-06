/** Direct-download hosts that TorBox web downloads are expected to support. */
const TORBOX_HOSTER_PREFIXES = [
  "https://gofile.io",
  "https://pixeldrain.com",
  "https://datanodes.to",
  "https://www.mediafire.com",
  "https://fuckingfast.co",
  "https://fuckingfast.net",
  "https://vikingfile.com",
  "https://vik1ngfile.site",
  "https://www.rootz.so",
];

export const isTorBoxHosterUri = (uri: string): boolean =>
  TORBOX_HOSTER_PREFIXES.some((prefix) => uri.startsWith(prefix));
