import type { GameShop } from "@types";

import type { CloudSaveRule } from "../manifest/types";

export type CloudSavePathPlatform = "windows" | "linux";

export type CloudSavePathToken =
  | "<base>"
  | "<home>"
  | "<storeUserId>"
  | "<winAppData>"
  | "<winLocalAppData>"
  | "<winDocuments>"
  | "<winPublic>"
  | "<winProgramData>"
  | "%APPDATA%"
  | "%LOCALAPPDATA%";

export interface CloudSavePathResolutionContext {
  shop: GameShop;
  objectId: string;
  platform: CloudSavePathPlatform;
  homeDir: string;
  documentsDir: string | null;
  appDataDir: string | null;
  localAppDataDir: string | null;
  publicDir: string | null;
  programDataDir: string | null;
  installDir: string | null;
  executablePath: string | null;
  winePrefixPath: string | null;
  protonPath: string | null;
  steamPath: string | null;
  steamUserIds: string[];
}

export type CloudSaveTokenValue = string[];

export type CloudSaveTokenMap = Partial<
  Record<CloudSavePathToken, CloudSaveTokenValue>
>;

export interface ResolvedCloudSavePath {
  rawPath: string;
  resolvedPaths: string[];
  unresolvedTokens: CloudSavePathToken[];
}

export interface ResolvedCloudSaveRule extends CloudSaveRule {
  resolvedPaths: string[];
  unresolvedTokens: CloudSavePathToken[];
}
