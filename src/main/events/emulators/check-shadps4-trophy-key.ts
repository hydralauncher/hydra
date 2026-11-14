import { registerEvent } from "../register-event";
import { getShadps4TrophyKeyStatus } from "@main/services/emulators/shadps4-files";

const checkShadps4TrophyKey = (
  _event: Electron.IpcMainInvokeEvent,
  executablePath: string | null
) => getShadps4TrophyKeyStatus(executablePath);

registerEvent("checkShadps4TrophyKey", checkShadps4TrophyKey);
