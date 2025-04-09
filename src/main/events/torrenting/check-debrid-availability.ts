import { HydraDebridClient } from "@main/services/download/hydra-debrid";
import { registerEvent } from "../register-event";

const checkDebridAvailability = async (
  _event: Electron.IpcMainInvokeEvent,
  magnets: string[]
) => {
  return HydraDebridClient.getAvailableMagnets(magnets);
};

registerEvent("checkDebridAvailability", checkDebridAvailability);
