import type { Game } from "@types";
import type { EpicInstallManifest } from "./session-attribution.js";

export interface EpicStoreAutoImportDependencies {
  listInstallations: (signal: AbortSignal) => Promise<EpicInstallManifest[]>;
  listGames: () => Promise<Game[]>;
  hasDownload: (objectId: string) => Promise<boolean>;
  importInstallation: (
    objectId: string,
    store: EpicInstallManifest,
    signal: AbortSignal
  ) => Promise<void>;
  afterImported: () => void;
  warn: (message: string, details: Record<string, unknown>) => void;
}

/**
 * Treats owned Epic games already installed by the Epic Games Store as
 * installed in Hydra, so their download button becomes a play button.
 */
export async function importEpicStoreInstallations(
  dependencies: EpicStoreAutoImportDependencies,
  signal: AbortSignal
) {
  const installations = await dependencies.listInstallations(signal);
  if (!installations.length) return 0;
  const games = await dependencies.listGames();
  let imported = 0;
  for (const store of installations) {
    if (signal.aborted) break;
    if (!store.namespace || !store.itemId) continue;
    const objectId = `${store.namespace}:${store.itemId}`;
    const game = games.find(
      (game) => game.shop === "epic" && game.objectId === objectId
    );
    if (
      !game ||
      game.isDeleted ||
      !game.hasActiveEpicImport ||
      game.epicInstallation ||
      (await dependencies.hasDownload(objectId))
    )
      continue;
    try {
      await dependencies.importInstallation(objectId, store, signal);
      imported++;
    } catch (error) {
      dependencies.warn("Epic Games Store installation was not imported", {
        objectId,
        code: (error as { code?: string })?.code,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (imported) dependencies.afterImported();
  return imported;
}

let running: Promise<number> | null = null;

/** Runs one scan at a time; later library syncs reuse the active scan. */
export function scheduleEpicStoreAutoImport(
  dependencies: EpicStoreAutoImportDependencies
) {
  running ??= importEpicStoreInstallations(
    dependencies,
    new AbortController().signal
  )
    .catch((error) => {
      dependencies.warn("Epic Games Store installations scan failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    })
    .finally(() => {
      running = null;
    });
  return running;
}
