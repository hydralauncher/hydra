import { registerEvent } from "../register-event";
import type { UserDetails } from "@types";
import { HydraApi } from "@main/services/hydra-api";
import { getUserData } from "@main/services/user/get-user-data";

let inFlight: {
  generation: number;
  promise: Promise<UserDetails | null>;
} | null = null;

const getMe = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<UserDetails | null> => {
  const generation = HydraApi.getAuthContext()?.generation ?? -1;

  let entry = inFlight;

  if (!entry || entry.generation !== generation) {
    const promise = getUserData();
    entry = { generation, promise };
    inFlight = entry;

    promise.then(
      () => {
        if (inFlight === entry) inFlight = null;
      },
      () => {
        if (inFlight === entry) inFlight = null;
      }
    );
  }

  return entry.promise;
};

registerEvent("getMe", getMe);
