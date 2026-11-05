import fs from "node:fs";
import path from "node:path";

import type {
  ClassicsDisc,
  RecompilationDetails,
  RecompilationRef,
} from "@types";
import {
  gamesSublevel,
  levelKeys,
  recompilationInstallsSublevel,
} from "@main/level";
import { HydraApi, logger, WindowManager } from "@main/services";
import { getCloudSaveRetroArchPlatform } from "@shared";
import {
  INSTALL_MARKER_FILE,
  type InstallMarker,
  readInstallMarker,
} from "./recompilation-paths";

const SHOP = "launchbox";

export interface RecompilationDiscInfo {
  name: string;
  iconUrl: string | null;
}

const notifyLibrary = () =>
  WindowManager.sendToAppWindows("on-library-batch-complete");

const updateGameDiscs = async (
  objectId: string,
  update: (discs: ClassicsDisc[]) => ClassicsDisc[] | null
) => {
  const key = levelKeys.game(SHOP, objectId);
  const game = await gamesSublevel.get(key).catch(() => undefined);
  if (!game) return false;

  const discs = update(game.discs ?? []);
  if (!discs) return false;

  const previous = game.selectedDiscPath;
  const selectionRemoved =
    typeof previous === "string" &&
    !discs.some((disc) => disc.path === previous);
  const fallback = getCloudSaveRetroArchPlatform(SHOP, game.platform)
    ? null
    : (discs[0]?.path ?? null);

  await gamesSublevel.put(key, {
    ...game,
    discs,
    selectedDiscPath: selectionRemoved ? fallback : previous,
  });
  return true;
};

export const addRecompilationDisc = async (
  ref: RecompilationRef,
  installDirectory: string,
  info: RecompilationDiscInfo
) => {
  const disc: ClassicsDisc = {
    path: installDirectory,
    label: info.name,
    fileName: info.name,
    recompilationSlug: ref.slug,
    iconUrl: info.iconUrl,
  };

  const changed = await updateGameDiscs(ref.objectId, (discs) => {
    const others = discs.filter((item) => item.recompilationSlug !== ref.slug);
    const current = discs.find((item) => item.recompilationSlug === ref.slug);
    if (
      current &&
      current.path === disc.path &&
      current.label === disc.label &&
      current.iconUrl === disc.iconUrl
    ) {
      return null;
    }
    return [...others, disc];
  });
  if (changed) notifyLibrary();
};

export const removeRecompilationDisc = async (ref: RecompilationRef) => {
  const changed = await updateGameDiscs(ref.objectId, (discs) =>
    discs.some((item) => item.recompilationSlug === ref.slug)
      ? discs.filter((item) => item.recompilationSlug !== ref.slug)
      : null
  );
  if (changed) notifyLibrary();
};

const readDiscInfo = async (
  ref: RecompilationRef,
  directory: string,
  marker: InstallMarker
): Promise<RecompilationDiscInfo> => {
  if (marker.name) {
    return { name: marker.name, iconUrl: marker.iconUrl ?? null };
  }

  const details = await HydraApi.get<RecompilationDetails>(
    `/games/launchbox/${ref.objectId}/recompilations/${ref.slug}`,
    undefined,
    { needsAuth: false }
  ).catch(() => null);
  if (!details) return { name: ref.slug, iconUrl: null };

  await fs.promises
    .writeFile(
      path.join(directory, INSTALL_MARKER_FILE),
      JSON.stringify(
        { ...marker, name: details.name, iconUrl: details.iconUrl },
        null,
        2
      )
    )
    .catch(() => {});
  return { name: details.name, iconUrl: details.iconUrl };
};

const isReachable = (directory: string) =>
  fs.promises
    .access(directory)
    .then(() => true)
    .catch(() => false);

export const reconcileRecompilationDiscs = async () => {
  try {
    const installed = new Map<string, RecompilationRef>();
    const unreachable = new Set<string>();

    for await (const [
      slug,
      directory,
    ] of recompilationInstallsSublevel.iterator()) {
      const marker = await readInstallMarker(directory);
      if (marker?.slug !== slug) {
        if (!(await isReachable(path.dirname(directory)))) {
          unreachable.add(slug);
        }
        continue;
      }

      const ref = { objectId: marker.objectId, slug };
      installed.set(slug, ref);
      await addRecompilationDisc(
        ref,
        directory,
        await readDiscInfo(ref, directory, marker)
      );
    }

    for await (const [, game] of gamesSublevel.iterator()) {
      if (game.shop !== SHOP) continue;
      for (const disc of game.discs ?? []) {
        const slug = disc.recompilationSlug;
        if (!slug || unreachable.has(slug)) continue;
        if (installed.get(slug)?.objectId === game.objectId) continue;
        await removeRecompilationDisc({ objectId: game.objectId, slug });
      }
    }
  } catch (error) {
    logger.error("Failed to reconcile recompilation discs", error);
  }
};
