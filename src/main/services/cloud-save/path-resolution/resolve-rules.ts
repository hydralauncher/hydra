import type { CloudSaveRule } from "../manifest/types";

import { buildCloudSaveTokenMap } from "./tokens";
import { resolveCloudSavePath } from "./resolve-path";
import type {
  CloudSavePathResolutionContext,
  ResolvedCloudSaveRule,
} from "./types";

export const resolveSaveRules = (
  rules: CloudSaveRule[],
  context: CloudSavePathResolutionContext
): ResolvedCloudSaveRule[] => {
  const tokenMap = buildCloudSaveTokenMap(context);

  return rules.map((rule) => ({
    ...rule,
    ...resolveCloudSavePath(rule.rawPath, context, tokenMap),
  }));
};
