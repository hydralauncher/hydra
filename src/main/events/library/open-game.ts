import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { launchGame } from "@main/helpers";
import {
  parseEpicLaunchOptions,
  parseEpicManagedObjectId,
} from "../epic/managed-ipc-contract";
import { assertTrustedEpicSender } from "../epic/assert-trusted-sender";

const openGame = async (
  event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  executablePath: string,
  launchOptions?: string | null,
  epicOptions?: unknown
) => {
  if (shop === "epic" || epicOptions !== undefined) {
    assertTrustedEpicSender(event, true);
    if (shop !== "epic") throw new Error("epic-launch-invalid-store");
    objectId = parseEpicManagedObjectId(objectId);
  }
  await launchGame({
    shop,
    objectId,
    executablePath,
    launchOptions,
    ...parseEpicLaunchOptions(epicOptions),
  });
};

registerEvent("openGame", openGame);
