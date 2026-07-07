import type { GameShop } from "@types";

export interface CloudSaveManifestSource {
  url: string;
}

export interface CloudSaveManifestRuleCondition {
  os?: string;
  store?: string;
}

export interface HydraManifestFileRule {
  rawPath: string;
  tags: string[];
  when: CloudSaveManifestRuleCondition[];
}

export interface HydraManifestGameEntry {
  manifestKey: string;
  files: HydraManifestFileRule[];
}

export interface HydraManifestIndex {
  version: 1;
  fetchedAt: number;
  sourceUrl: string;
  games: Record<string, HydraManifestGameEntry>;
}

export interface CloudSaveGameId {
  shop: GameShop;
  objectId: string;
}

export interface CloudSaveRule {
  kind: "file" | "dir";
  rawPath: string;
  source: "ludusavi";
  tags: string[];
  when: CloudSaveManifestRuleCondition[];
}

export interface GameSaveRules {
  gameId: CloudSaveGameId;
  manifestKey: string | null;
  rules: CloudSaveRule[];
}
