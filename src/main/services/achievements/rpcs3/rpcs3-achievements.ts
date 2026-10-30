import { promises as fs } from "node:fs";
import path from "node:path";
import type { Game, GameShop, UserAchievement, UserPreferences } from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { isClassicsGameForEmulator } from "../../../../shared/classics-emulator-games.js";
import { getEmulatorConfig } from "../../emulators/emulators-repository";
import { resolveRpcs3ConfigRootStatus } from "../../cloud-save/rpcs3-config-root";
import { WindowManager } from "../../window-manager";
import { achievementsLogger } from "../../logger";
import { AchievementMemoryStore } from "../achievement-memory-store";
import { UnlockedAchievementsCache } from "../unlocked-achievements-cache";
import { publishAchievementUnlockNotifications } from "../achievement-unlock-notifications";
import { findGameTrophySetIds, resolveTrophyUser } from "./trophy-discovery.js";
import { readTrophySet } from "./trophy-data.js";
import { TrophyWatcher } from "./trophy-watcher.js";

interface Monitor {
  game: Game;
  identity: string | null;
  rows: UserAchievement[];
  watcher: TrophyWatcher;
  pending: Promise<UserAchievement[]> | null;
  closed: boolean;
}
const monitors = new Map<string, Monitor>();

const publishView = (monitor: Monitor) => {
  const { game } = monitor;
  WindowManager.mainWindow?.webContents.send(
    `on-update-achievements-${game.objectId}-${game.shop}`,
    monitor.rows
  );
  WindowManager.sendToAppWindows("on-library-batch-complete");
};

const clearView = (monitor: Monitor) => {
  const { game } = monitor;
  const changed = monitor.rows.length > 0;
  monitor.rows = [];
  monitor.identity = null;
  AchievementMemoryStore.delete(game.shop, game.objectId);
  UnlockedAchievementsCache.invalidate(game.shop, game.objectId);
  if (changed) publishView(monitor);
};

const refresh = async (monitor: Monitor): Promise<UserAchievement[]> => {
  const game = await gamesSublevel.get(
    levelKeys.game(monitor.game.shop, monitor.game.objectId)
  );
  if (
    !game ||
    !isClassicsGameForEmulator(game, { kind: "emulator", system: "ps3" })
  ) {
    monitor.watcher.close();
    monitor.closed = true;
    clearView(monitor);
    return [];
  }
  monitor.game = game;
  const config = await getEmulatorConfig("ps3");
  const { location } = await resolveRpcs3ConfigRootStatus(
    config.executablePath,
    config.rpcs3ConfigRoot
  );
  const user = location
    ? await resolveTrophyUser(location.configRoot, location.homeRoot)
    : null;
  if (!location || !user) {
    clearView(monitor);
    monitor.watcher.setDirectories(
      location
        ? [
            location.configRoot,
            path.join(location.configRoot, "GuiConfigs"),
            location.homeRoot,
          ]
        : []
    );
    return [];
  }
  const root = path.join(location.homeRoot, user, "trophy");
  const setIds = await findGameTrophySetIds(game);
  const identity = JSON.stringify([location.configRoot, root, setIds]);
  const sameIdentity = monitor.identity === identity;
  // Never retain a different RPCS3 user's data when a new read fails.
  if (!sameIdentity) {
    clearView(monitor);
  }
  const directories = [
    location.configRoot,
    path.join(location.configRoot, "GuiConfigs"),
    location.homeRoot,
    path.dirname(root),
    root,
  ];
  directories.push(path.dirname(location.homeRoot));
  for (const id of setIds) directories.push(path.join(root, id));
  const relevantNames = new Map<string, ReadonlySet<string>>([
    [location.configRoot, new Set(["vfs.yml", "config.yml", "guiconfigs"])],
    [
      path.join(location.configRoot, "GuiConfigs"),
      new Set(["persistent_settings.dat"]),
    ],
    [path.dirname(location.homeRoot), new Set(["home"])],
    [path.dirname(root), new Set(["trophy"])],
    [root, new Set(setIds.map((id) => id.toLowerCase()))],
    ...setIds.map((id): [string, ReadonlySet<string>] => [
      path.join(root, id),
      new Set(["tropusr.dat", "tropconf.sfm"]),
    ]),
  ]);
  monitor.watcher.setDirectories(directories, relevantNames);
  const rows: UserAchievement[] = [];
  for (const id of setIds) {
    const directory = path.join(root, id);
    if (!(await fs.stat(directory).catch(() => null))?.isDirectory()) {
      if (sameIdentity && monitor.rows.some((row) => row.externalSetId === id))
        throw new Error("RPCS3 trophy directory temporarily unavailable");
      continue; // RPCS3 installs each trophy set on its first registration.
    }
    rows.push(...(await readTrophySet(directory, id, true)));
  }
  if (monitor.closed) return [];
  const old = new Map(monitor.rows.map((row) => [row.name, row]));
  const newUnlocks = sameIdentity
    ? rows.filter(
        (row) => row.unlocked && old.get(row.name)?.unlocked === false
      )
    : [];
  const changed = JSON.stringify(rows) !== JSON.stringify(monitor.rows);
  monitor.rows = rows;
  monitor.identity = identity;
  AchievementMemoryStore.set(game.shop, game.objectId, {
    achievements: rows,
    unlockedAchievements: rows
      .filter((row) => row.unlocked)
      .map((row) => ({ name: row.name, unlockTime: row.unlockTime ?? 0 })),
  });
  UnlockedAchievementsCache.invalidate(game.shop, game.objectId);
  if (changed) publishView(monitor);
  if (newUnlocks.length) {
    const preferences = await db
      .get<
        string,
        UserPreferences | null
      >(levelKeys.userPreferences, { valueEncoding: "json" })
      .catch(() => null);
    if (!monitor.closed)
      publishAchievementUnlockNotifications({
        game,
        achievements: newUnlocks,
        completesGame: false,
        unlockedAchievementCount: rows.filter((row) => row.unlocked).length,
        totalAchievementCount: rows.length,
        userPreferences: preferences,
      });
  }
  return rows;
};

const refreshOnce = (monitor: Monitor) => {
  if (!monitor.pending)
    monitor.pending = refresh(monitor).finally(() => {
      monitor.pending = null;
    });
  return monitor.pending;
};

/** null means a different achievement provider owns this game. Local trophies are never uploaded as Steam/RA unlocks. */
export const getRpcs3Achievements = async (
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[] | null> => {
  if (shop !== "launchbox") return null;
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  if (
    !game ||
    !isClassicsGameForEmulator(game, { kind: "emulator", system: "ps3" })
  )
    return null;
  let monitor = monitors.get(gameKey);
  if (!monitor || monitor.closed) {
    const next: Monitor = {
      game,
      identity: null,
      rows: [],
      pending: null,
      closed: false,
      watcher: null!,
    };
    next.watcher = new TrophyWatcher(
      async () => {
        await refreshOnce(next);
      },
      (error) => achievementsLogger.warn("RPCS3 trophy refresh deferred", error)
    );
    monitors.set(gameKey, next);
    monitor = next;
  }
  try {
    return await refreshOnce(monitor);
  } catch (error) {
    achievementsLogger.warn("Could not read RPCS3 trophies", gameKey, error);
    monitor.watcher.trigger();
    return monitor.rows;
  }
};

export const stopRpcs3TrophyWatchers = () => {
  for (const monitor of monitors.values()) {
    monitor.closed = true;
    monitor.watcher.close();
  }
  monitors.clear();
};

export const initializeRpcs3Trophies = async () => {
  const games = (await gamesSublevel.values().all()).filter((game) =>
    isClassicsGameForEmulator(game, { kind: "emulator", system: "ps3" })
  );
  for (let i = 0; i < games.length; i += 4)
    await Promise.all(
      games
        .slice(i, i + 4)
        .map((game) => getRpcs3Achievements(game.objectId, game.shop))
    );
};
