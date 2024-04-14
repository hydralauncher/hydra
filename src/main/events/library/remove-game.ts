import { registerEvent } from "../register-event";
import { gameRepository } from "../../repository";

const removeGame = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => gameRepository.delete({ id: gameId });

registerEvent(removeGame, {
  name: "removeGame",
});
