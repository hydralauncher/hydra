import type {
  CloudSavePathToken,
  CloudSavePathResolutionContext,
  CloudSaveTokenMap,
} from "./types";

const normalizeTokenValues = (
  values: Array<string | null | undefined>
): string[] => {
  return Array.from(
    new Set(
      values.filter((value): value is string => {
        return typeof value === "string" && value.length > 0;
      })
    )
  );
};

const addToken = (
  tokenMap: CloudSaveTokenMap,
  token: CloudSavePathToken,
  values: Array<string | null | undefined>
): void => {
  const normalizedValues = normalizeTokenValues(values);

  if (normalizedValues.length > 0) {
    tokenMap[token] = normalizedValues;
  }
};

export const buildCloudSaveTokenMap = (
  context: CloudSavePathResolutionContext
): CloudSaveTokenMap => {
  const tokenMap: CloudSaveTokenMap = {};

  addToken(tokenMap, "<base>", [context.installDir]);
  addToken(tokenMap, "<home>", [context.homeDir]);
  addToken(tokenMap, "<storeUserId>", context.steamUserIds);
  addToken(tokenMap, "<winAppData>", [context.appDataDir]);
  addToken(tokenMap, "%APPDATA%", [context.appDataDir]);
  addToken(tokenMap, "<winLocalAppData>", [context.localAppDataDir]);
  addToken(tokenMap, "%LOCALAPPDATA%", [context.localAppDataDir]);
  addToken(tokenMap, "<winDocuments>", [context.documentsDir]);
  addToken(tokenMap, "<winPublic>", [context.publicDir]);
  addToken(tokenMap, "<winProgramData>", [context.programDataDir]);

  return tokenMap;
};
