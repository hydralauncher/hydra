import { registerEvent } from "../register-event";
import { getVariants } from "@main/services";
import type { GameShop, SgdbAssetType } from "@types";

interface GetVariantsOptions {
  types?: SgdbAssetType[];
  forceFresh?: boolean;
  term?: string;
}

const getSteamGridDbVariants = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  options?: GetVariantsOptions
) => {
  return getVariants(shop, objectId, options ?? {});
};

registerEvent("getSteamGridDbVariants", getSteamGridDbVariants);
