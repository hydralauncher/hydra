import type { GameShop } from "./game.types";

export interface CloudSaveRuleCondition {
  os?: string;
  store?: string;
}

export interface ResolvedCloudSaveRule {
  kind: "file" | "dir";
  rawPath: string;
  source: "ludusavi";
  tags: string[];
  when: CloudSaveRuleCondition[];
  resolvedPaths: string[];
  unresolvedTokens: string[];
}

export interface ResolvedGameSaveRules {
  gameId: {
    shop: GameShop;
    objectId: string;
  };
  manifestKey: string | null;
  rules: ResolvedCloudSaveRule[];
}
