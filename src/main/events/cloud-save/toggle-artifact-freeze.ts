import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const toggleArtifactFreeze = async (
  _event: Electron.IpcMainInvokeEvent,
  gameArtifactId: string,
  freeze: boolean
) => {
  if (freeze) {
    await HydraApi.put(`/profile/games/artifacts/${gameArtifactId}/freeze`);
  } else {
    await HydraApi.put(`/profile/games/artifacts/${gameArtifactId}/unfreeze`);
  }
};

registerEvent("toggleArtifactFreeze", toggleArtifactFreeze);
