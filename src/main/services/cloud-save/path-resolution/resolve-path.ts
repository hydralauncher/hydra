import path from "node:path";

import type {
  CloudSavePathToken,
  CloudSavePathResolutionContext,
  CloudSaveTokenMap,
  ResolvedCloudSavePath,
} from "./types";

const PATH_RESOLUTION_TOKENS: CloudSavePathToken[] = [
  "<base>",
  "<home>",
  "<storeUserId>",
  "<winAppData>",
  "<winLocalAppData>",
  "<winDocuments>",
  "<winPublic>",
  "<winProgramData>",
  "%APPDATA%",
  "%LOCALAPPDATA%",
];

const WINDOWS_LIKE_TOKENS = new Set<CloudSavePathToken>([
  "<winAppData>",
  "<winLocalAppData>",
  "<winDocuments>",
  "<winPublic>",
  "<winProgramData>",
  "%APPDATA%",
  "%LOCALAPPDATA%",
]);

const getPathResolutionTokens = (): CloudSavePathToken[] =>
  PATH_RESOLUTION_TOKENS;

const getTokensUsedByRawPath = (rawPath: string): CloudSavePathToken[] => {
  return getPathResolutionTokens().filter((token) => rawPath.includes(token));
};

const usesWindowsLikeToken = (rawPath: string): boolean => {
  return getTokensUsedByRawPath(rawPath).some((token) =>
    WINDOWS_LIKE_TOKENS.has(token)
  );
};

const dedupePaths = (paths: string[]): string[] => {
  return Array.from(new Set(paths));
};

const normalizeResolvedPath = (value: string): string => {
  return path.posix.normalize(value).replaceAll("\\", "/");
};

const expandPathWithTokenValues = (
  rawPath: string,
  tokenMap: CloudSaveTokenMap,
  tokensUsed: CloudSavePathToken[]
): string[] => {
  return tokensUsed.reduce<string[]>(
    (paths, token) => {
      const tokenValues = tokenMap[token];

      if (!tokenValues || tokenValues.length === 0) {
        return paths;
      }

      return paths.flatMap((currentPath) =>
        tokenValues.map((value) => currentPath.replaceAll(token, value))
      );
    },
    [rawPath]
  );
};

const applyRuntimePathResolution = (
  expandedPath: string,
  rawPath: string,
  context: CloudSavePathResolutionContext
): string => {
  if (
    context.platform === "linux" &&
    usesWindowsLikeToken(rawPath) &&
    context.winePrefixPath
  ) {
    return normalizeResolvedPath(
      path.join(context.winePrefixPath, expandedPath)
    );
  }

  return normalizeResolvedPath(expandedPath);
};

export const resolveCloudSavePath = (
  rawPath: string,
  context: CloudSavePathResolutionContext,
  tokenMap: CloudSaveTokenMap
): ResolvedCloudSavePath => {
  const tokensUsed = getTokensUsedByRawPath(rawPath);
  const unresolvedTokens = tokensUsed.filter((token) => {
    const tokenValues = tokenMap[token];
    return !tokenValues || tokenValues.length === 0;
  });

  if (unresolvedTokens.length > 0) {
    return {
      rawPath,
      resolvedPaths: [],
      unresolvedTokens,
    };
  }

  const resolvedPaths = dedupePaths(
    expandPathWithTokenValues(rawPath, tokenMap, tokensUsed).map(
      (expandedPath) =>
        applyRuntimePathResolution(expandedPath, rawPath, context)
    )
  );

  return {
    rawPath,
    resolvedPaths,
    unresolvedTokens: [],
  };
};
