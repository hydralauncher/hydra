import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

const deleteGameArtifact = async (
  _event: Electron.IpcMainInvokeEvent,
  gameArtifactId: string
) =>
  HydraApi.delete<{ ok: boolean }>(
    `/profile/games/artifacts/${gameArtifactId}`
  );

registerEvent("deleteGameArtifact", deleteGameArtifact);
