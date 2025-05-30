import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const renameGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  gameArtifactId: string,
  label: string
) => {
  await HydraApi.put(`/profile/games/artifacts/${gameArtifactId}`, {
    label,
  });
};

registerEvent("renameGameArtifact", renameGameArtifact);
