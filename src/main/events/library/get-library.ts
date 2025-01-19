import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";

const getLibrary = async () => {
  // TODO: Add sorting
  return gamesSublevel
    .values()
    .all()
    .then((results) => {
      return results.filter((game) => game.isDeleted === false);
    });
};

registerEvent("getLibrary", getLibrary);
