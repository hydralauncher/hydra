import { registerEvent } from "../register-event";
import { HosterAvailabilityApi } from "@main/services/hosters";

const checkHostersAvailability = async (
  _event: Electron.IpcMainInvokeEvent,
  uris: string[]
): Promise<Record<string, boolean>> => {
  if (!Array.isArray(uris) || uris.length === 0) return {};

  return HosterAvailabilityApi.check(uris);
};

registerEvent("checkHostersAvailability", checkHostersAvailability);
