import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";

const removeGameFromLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  gameRepository.update({ id: gameId }, { isDeleted: true });
};

registerEvent("removeGameFromLibrary", removeGameFromLibrary);
