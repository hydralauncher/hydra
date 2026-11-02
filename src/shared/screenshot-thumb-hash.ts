import { thumbHashToDataURL } from "thumbhash";

const decodeBase64 = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);

export const getScreenshotThumbHashUrl = (
  thumbHash: string | null | undefined
) => {
  if (!thumbHash) return null;

  try {
    return thumbHashToDataURL(decodeBase64(thumbHash));
  } catch {
    return null;
  }
};
