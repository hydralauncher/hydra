import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";
import type { GameArtifact, GameShop } from "@types";
import { SubscriptionRequiredError, UserNotLoggedInError } from "@shared";

const getGameArtifacts = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const params = new URLSearchParams({
    objectId,
    shop,
  });

  return HydraApi.get<GameArtifact[]>(
    `/profile/games/artifacts?${params.toString()}`,
    {},
    { needsSubscription: true }
  ).catch((err) => {
    if (err instanceof SubscriptionRequiredError) {
      return [];
    }

    if (err instanceof UserNotLoggedInError) {
      return [];
    }

    throw err;
  });
};

registerEvent("getGameArtifacts", getGameArtifacts);
