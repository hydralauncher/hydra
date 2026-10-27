import { shell } from "electron";
import path from "node:path";
import { registerEvent } from "../register-event";
import {
  getEcosystem,
  getGameStatus,
  getPackageIndex,
  installMod,
  searchPackages,
  setGameCommunity,
  setModEnabled,
  uninstallMod,
} from "@main/services/mods";
import { modsRoot } from "@main/services/mods/paths";
import type { GameShop } from "@types";
import type { ModLoaderId, ModSearchOptions } from "@types";

registerEvent("modsGetStatus", (_e, shop: GameShop, objectId: string) =>
  getGameStatus(shop, objectId)
);

registerEvent("modsListCommunities", async () => {
  const games = await getEcosystem();
  return games.map(({ identifier, name, packageLoader }) => ({
    identifier,
    name,
    packageLoader,
  }));
});

registerEvent(
  "modsSetCommunity",
  (
    _e,
    shop: GameShop,
    objectId: string,
    community: string,
    loader?: ModLoaderId
  ) => setGameCommunity(shop, objectId, community, loader)
);

registerEvent(
  "modsSearch",
  (_e, community: string, options: ModSearchOptions) =>
    searchPackages(community, options)
);

registerEvent("modsRefreshIndex", async (_e, community: string) => {
  await getPackageIndex(community, true);
});

registerEvent(
  "modsInstall",
  (_e, shop: GameShop, objectId: string, fullName: string, version?: string) =>
    installMod(shop, objectId, fullName, version)
);

registerEvent(
  "modsUninstall",
  (
    _e,
    shop: GameShop,
    objectId: string,
    fullName: string,
    removeOrphans?: boolean
  ) => uninstallMod(shop, objectId, fullName, removeOrphans)
);

registerEvent(
  "modsSetEnabled",
  (_e, shop: GameShop, objectId: string, fullName: string, enabled: boolean) =>
    setModEnabled(shop, objectId, fullName, enabled)
);

registerEvent(
  "modsOpenFolder",
  async (_e, shop: GameShop, objectId: string) => {
    const status = await getGameStatus(shop, objectId);
    await shell.openPath(status.gameDir ?? path.join(modsRoot));
  }
);
