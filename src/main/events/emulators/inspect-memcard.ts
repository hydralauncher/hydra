import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulationSavePlatform, MemcardFormatState } from "@types";

const inspectMemcard = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  cardFilePath: string
): Promise<MemcardFormatState> =>
  platform === "ps2"
    ? emulators.inspectPs2Card(cardFilePath)
    : emulators.inspectPs1Card(cardFilePath);

registerEvent("inspectMemcard", inspectMemcard);
