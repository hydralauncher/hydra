import type { Game } from "@types";
import { SystemPath } from "../system-path";
import { managedWorkspacePath } from "./legendary-managed-runtime";
import {
  getEpicLinuxLastPreparedPrefix,
  resolveEpicLinuxPrefixPath,
  withEpicLinuxPrefixMutation,
} from "./linux-runtime";
import { disposeEpicOwnershipTokenIfStopped } from "./ownership-token.js";

/** A surviving game or an incomplete process inspection keeps its token. */
export async function reconcileEpicLinuxOwnershipTokens(games: Game[]) {
  if (process.platform !== "linux") return { removed: 0, preserved: 0 };
  const result = { removed: 0, preserved: 0 };
  for (const game of games) {
    const installation = game.epicInstallation;
    if (
      game.shop !== "epic" ||
      !installation ||
      installation.platform !== "Windows"
    )
      continue;
    try {
      const prefix = await resolveEpicLinuxPrefixPath(
        game,
        installation.owner,
        installation.artifactId
      );
      // Preferences may now select a different prefix while a game launched
      // before Hydra restarted still uses this workspace's deterministic OVT.
      // Only the durable receipt can identify the context that owns that file.
      if ((await getEpicLinuxLastPreparedPrefix(game)) !== prefix) {
        result.preserved++;
        continue;
      }
      const removed = await withEpicLinuxPrefixMutation(prefix, async () => {
        // Revalidate under the prefix lease so a concurrent preparation cannot
        // replace the receipt between this evidence and token removal.
        if ((await getEpicLinuxLastPreparedPrefix(game)) !== prefix)
          throw new Error("compatibility-prefix-busy");
        return disposeEpicOwnershipTokenIfStopped(
          managedWorkspacePath(
            SystemPath.getPath("userData"),
            installation.owner,
            installation.artifactId,
            installation.platform
          ),
          game.objectId
        );
      });
      if (removed) result.removed++;
    } catch {
      // Unreadable paths/processes are preserved; startup remains usable and a
      // later stopped-prefix launch can safely reserve the deterministic token.
      result.preserved++;
    }
  }
  return result;
}
