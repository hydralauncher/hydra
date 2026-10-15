import type { Game } from "@types";
import { gamesSublevel } from "@main/level";
import {
  libraryWriteQueue,
  hasPendingHydraClaim,
} from "../library-sync/library-write-queue";
import type { EpicAuthContext } from "./integration-core";

export const matchesEpicImportScope = (
  game: Game,
  context: Pick<EpicAuthContext, "environment" | "userId">,
  connectionId?: string
) =>
  game.epicImportScope?.environment === context.environment &&
  game.epicImportScope.userId === context.userId &&
  (!connectionId || game.epicImportScope.connectionId === connectionId);

export async function clearEpicImports(
  context?: Pick<EpicAuthContext, "environment" | "userId">,
  connectionId?: string,
  accountChanged = false,
  current: () => boolean = () => true
) {
  return libraryWriteQueue.run(async () => {
    if (!current()) return 0;
    const updates: { type: "put"; key: string; value: Game }[] = [];
    for (const [key, game] of await gamesSublevel.iterator().all()) {
      if (
        !game.hasActiveEpicImport &&
        !game.epicImportScope &&
        !game.epicPlayTimeInMilliseconds
      )
        continue;
      if (context && !matchesEpicImportScope(game, context, connectionId))
        continue;
      const exclusive = game.source === "epic" && !hasPendingHydraClaim(key);
      updates.push({
        type: "put",
        key,
        value: {
          ...game,
          epicPlayTimeInMilliseconds: 0,
          hasActiveEpicImport: false,
          epicImportScope: undefined,
          ...(accountChanged || exclusive ? { remoteId: null } : {}),
          ...(exclusive ? { isDeleted: true } : {}),
        },
      });
    }
    if (!current()) return 0;
    if (updates.length) await gamesSublevel.batch(updates);
    return updates.length;
  });
}

export async function clearStaleEpicImports(
  context: EpicAuthContext | null,
  current: () => boolean = () => true,
  connectionId?: string | null
) {
  return libraryWriteQueue.run(async () => {
    if (!current()) return 0;
    const updates: { type: "put"; key: string; value: Game }[] = [];
    for (const [key, game] of await gamesSublevel.iterator().all()) {
      if (
        (!game.hasActiveEpicImport &&
          !game.epicImportScope &&
          !game.epicPlayTimeInMilliseconds) ||
        (context &&
          matchesEpicImportScope(game, context) &&
          (connectionId === undefined ||
            (connectionId !== null &&
              game.epicImportScope?.connectionId === connectionId)))
      )
        continue;
      const exclusive = game.source === "epic" && !hasPendingHydraClaim(key);
      updates.push({
        type: "put",
        key,
        value: {
          ...game,
          epicPlayTimeInMilliseconds: 0,
          hasActiveEpicImport: false,
          epicImportScope: undefined,
          ...(context && matchesEpicImportScope(game, context) && !exclusive
            ? {}
            : { remoteId: null }),
          ...(exclusive ? { isDeleted: true } : {}),
        },
      });
    }
    if (!current()) return 0;
    if (updates.length) await gamesSublevel.batch(updates);
    return updates.length;
  });
}
