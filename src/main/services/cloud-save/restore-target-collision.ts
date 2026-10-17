import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import type { ResolveRestoreTargetsResult } from "@types";

export const canonicalRestoreTargetKey = (
  targetPath: string,
  caseSensitive: boolean
) => {
  let existing = path.resolve(targetPath);
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }

  let canonical = existing;
  try {
    canonical = realpathSync.native(existing);
  } catch {
    // Match the native resolver when an existing ancestor cannot be resolved.
  }
  const normalized = path.join(canonical, ...missing).replaceAll("\\", "/");
  return caseSensitive ? normalized : normalized.toLowerCase();
};

export const blockAmbiguousRestoreTargets = (
  plan: ResolveRestoreTargetsResult,
  caseSensitive: boolean
): ResolveRestoreTargetsResult => {
  const targetCounts = new Map<string, number>();
  const keyedActions = plan.actions.map((action) => ({
    action,
    key: canonicalRestoreTargetKey(action.targetPath, caseSensitive),
  }));
  for (const { key } of keyedActions) {
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }

  const actions: ResolveRestoreTargetsResult["actions"] = [];
  const blocked = [...plan.blocked];
  for (const { action, key } of keyedActions) {
    if (targetCounts.get(key) === 1) {
      actions.push(action);
    } else {
      blocked.push({
        variantId: action.variantId,
        rawPath: action.rawPath,
        relativePath: action.relativePath,
        hash: action.hash,
        sizeBytes: action.sizeBytes,
        lastModifiedAt: action.lastModifiedAt,
        reason: "blocked-target-ambiguous",
      });
    }
  }
  return { ...plan, actions, blocked };
};
