import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulationSavePlatform, MemcardFormatState } from "@types";

const inspectMemcard = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  cardFilePath: string
): Promise<MemcardFormatState> => {
  if (platform === "ps2") return emulators.inspectPs2Card(cardFilePath);
  if (platform === "ps1") return emulators.inspectPs1Card(cardFilePath);
  return "formatted";
};

registerEvent("inspectMemcard", inspectMemcard);
